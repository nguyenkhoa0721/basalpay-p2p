import { Telegraf } from "telegraf";
import { Scenes } from "telegraf";
import Redis from "ioredis";
import moment from "moment";
import { BankService } from "./bank.service";
import { BasalPayService } from "./basal-pay.service";
import { RedisHelper } from "../utils/redis-helper";
import { telegramTemplates, telegramKeyboards } from "../utils/messages/telegram-templates";
import { Config } from "../config";
import { isWithinOperatingHours } from "../utils/time-helper";

// Initialize the Basal Pay service
const basalPayService = new BasalPayService();

/**
 * Sets up transaction monitoring for incoming payments
 */
export function setupTransactionMonitor(
    bot: Telegraf<Scenes.SceneContext>,
    redis: Redis,
    redisHelper: RedisHelper,
    bankService: BankService
): void {
    const intervalMs = Config.transactionCheck.intervalMs;
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 5;

    const intervalId = setInterval(async () => {
        if (!isWithinOperatingHours()) {
            console.log("Skipping transaction check outside operating hours");
            return;
        }

        try {
            await checkTransactions(bot, redis, redisHelper, bankService);
            consecutiveErrors = 0; // Reset error counter on success
        } catch (error) {
            consecutiveErrors++;
            console.error(
                `Error in transaction check cycle (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`,
                error
            );

            // Handle session expiry by re-logging in
            if (error instanceof Error && error.message.includes("GW200")) {
                try {
                    await bankService.login();
                    console.log("Re-logged in to MB Bank after session expiry");
                    consecutiveErrors = 0; // Reset error counter on successful login
                } catch (loginError) {
                    console.error("Failed to re-login to MB Bank:", loginError);
                }
            }

            // If too many consecutive errors, notify admin and pause monitoring
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                console.error("Too many consecutive errors, pausing transaction monitoring");

                if (Config.adminChatId) {
                    try {
                        await bot.telegram.sendMessage(
                            Config.adminChatId,
                            `❌ ALERT: Transaction monitoring paused after ${MAX_CONSECUTIVE_ERRORS} consecutive errors. System needs attention.`
                        );
                    } catch (notifyError) {
                        console.error("Failed to notify admin about monitoring pause", notifyError);
                    }
                }

                clearInterval(intervalId);
            }
        }
    }, intervalMs);

    console.log(`Transaction monitoring started (checking every ${intervalMs / 1000} seconds)`);
}

/**
 * Checks for incoming transactions and processes them
 */
async function checkTransactions(
    bot: Telegraf<Scenes.SceneContext>,
    redis: Redis,
    redisHelper: RedisHelper,
    bankService: BankService
): Promise<void> {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Running transaction check...`);

    const balance = await bankService.getBalance();
    if (!balance?.balances?.length) {
        throw new Error("Could not retrieve account balance");
    }

    const account = balance.balances.find((acc) => acc.number === Config.bank.accountNumber);
    if (!account) {
        throw new Error(`Account ${Config.bank.accountNumber} not found in balance list`);
    }

    // Get transactions from the last hour but limit search window to avoid overloading
    const fromDate = moment().subtract(1, "hour");
    const toDate = moment();
    const transactions = await bankService.getTransactionsHistory({
        accountNumber: account.number,
        fromDate,
        toDate,
    });

    if (!transactions?.length) {
        console.log(`[${timestamp}] No transactions found in the last hour`);
        return;
    }

    // Filter for incoming transactions only and sort by most recent first
    const creditTransactions = transactions
        .filter((tx) => tx.creditAmount && parseInt(tx.creditAmount) > 0)
        .sort((a, b) => {
            const dateA = new Date(a.transactionDate).getTime();
            const dateB = new Date(b.transactionDate).getTime();
            return dateB - dateA; // Most recent first
        });

    console.log(
        `[${timestamp}] Found ${creditTransactions.length} credit transactions out of ${transactions.length} total`
    );

    // Get all pending payments
    const pendingPaymentIds = await redisHelper.getPendingPayments();
    if (!pendingPaymentIds.length) {
        console.log(`[${timestamp}] No pending payments to process`);
        return;
    }

    console.log(`[${timestamp}] Processing ${pendingPaymentIds.length} pending payments`);

    // Process each pending payment with proper error handling
    for (const paymentId of pendingPaymentIds) {
        try {
            await processPayment(bot, redis, redisHelper, paymentId, creditTransactions);
        } catch (paymentError: any) {
            console.error(`Error processing payment ${paymentId}:`, paymentError);

            // Mark payment for manual review if processing fails
            try {
                const paymentData = await redisHelper.getPayment(paymentId);
                if (paymentData && paymentData.status === "pending") {
                    await redisHelper.updatePaymentStatus(paymentId, "error", {
                        errorMessage: paymentError.message || "Unknown error during processing",
                        errorTimestamp: Date.now().toString(),
                    });

                    // Notify admin of the error if configured
                    if (Config.adminChatId) {
                        await notifyAdminOfError(bot, paymentId, paymentData, paymentError);
                    }
                }
            } catch (markError) {
                console.error(`Failed to mark payment ${paymentId} as error:`, markError);
            }
        }
    }
}

/**
 * Process a single payment, checking if it has been received
 */
async function processPayment(
    bot: Telegraf<Scenes.SceneContext>,
    redis: Redis,
    redisHelper: RedisHelper,
    paymentId: string,
    creditTransactions: any[]
): Promise<void> {
    const timestamp = new Date().toISOString();

    // Get payment data with proper error handling
    const paymentData = await redisHelper.getPayment(paymentId);
    if (!paymentData) {
        throw new Error(`Payment ${paymentId} not found in Redis`);
    }

    if (paymentData.status !== "pending") {
        return;
    }

    // Parse numeric values safely
    const amountVND = parseInt(paymentData.amountVND);
    if (isNaN(amountVND)) {
        throw new Error(`Invalid VND amount for payment ${paymentId}: ${paymentData.amountVND}`);
    }

    const memo = paymentData.memo;
    if (!memo) {
        throw new Error(`Missing memo for payment ${paymentId}`);
    }

    // Check payment expiration
    const expiresAt = parseInt(paymentData.expiresAt || "0");
    if (expiresAt > 0 && Date.now() > expiresAt) {
        console.log(`Payment ${paymentId} has expired, marking as expired`);
        await redisHelper.updatePaymentStatus(paymentId, "expired");
        await redisHelper.removeFromExpirySet(paymentId);
        return;
    }

    // Check if this payment has been received, with better transaction matching
    const matchingTransaction = creditTransactions.find((tx) => {
        // Safely parse transaction amount
        const txAmount = parseInt(tx.creditAmount || "0");
        if (isNaN(txAmount)) return false;

        // Check both memo and amount with tolerance for small discrepancies
        // Some banks might add fees that slightly change the amount
        const hasMemo = tx.transactionDesc && tx.transactionDesc.includes(memo);
        const amountMatches = Math.abs(txAmount - amountVND) <= 1000; // 1000 VND tolerance

        return hasMemo && amountMatches;
    });

    if (!matchingTransaction) {
        // No matching transaction found, payment still pending
        return;
    }

    console.log(`[${timestamp}] Found matching transaction for payment ${paymentId}`);

    // Payment received, mark as processing
    await redisHelper.updatePaymentStatus(paymentId, "processing", {
        vndReceivedAt: Date.now().toString(),
        transactionRef: matchingTransaction.refNo,
        transactionDate: matchingTransaction.transactionDate,
        processingStartedAt: Date.now().toString(),
    });

    try {
        // Process USDT transfer if needed
        if (!paymentData.usdtTransactionId) {
            console.log(`[${timestamp}] Processing USDT transfer for payment ${paymentId}`);
            await processUsdtTransfer(bot, redis, redisHelper, paymentId, paymentData);
        } else {
            // USDT already sent, just complete the payment
            console.log(
                `[${timestamp}] USDT already sent for payment ${paymentId}, marking as completed`
            );
            await redisHelper.updatePaymentStatus(paymentId, "completed");
            await redisHelper.completePayment(paymentId);
        }

        // Notify user of completed payment
        await notifyUser(bot, paymentData, matchingTransaction.refNo);

        // Notify admin of completed payment
        await notifyAdmin(bot, paymentId, paymentData, matchingTransaction.refNo);

        console.log(`[${timestamp}] Payment ${paymentId} fully processed and completed`);
    } catch (error: any) {
        console.error(`Error processing USDT transfer for payment ${paymentId}:`, error);

        // Mark payment for manual review with detailed error info
        await redisHelper.updatePaymentStatus(paymentId, "manual_review", {
            error: error.message,
            errorStack: error.stack,
            errorTimestamp: Date.now().toString(),
        });

        // Notify admin of error
        await notifyAdminOfError(bot, paymentId, paymentData, error);
    }
}

/**
 * Notify the user about their completed payment
 */
async function notifyUser(
    bot: Telegraf<Scenes.SceneContext>,
    paymentData: Record<string, string>,
    transactionRef: string
): Promise<void> {
    if (!paymentData.userId) {
        return;
    }

    try {
        await bot.telegram.sendMessage(
            paymentData.userId,
            telegramTemplates.paymentConfirmed({
                amountUSDT: paymentData.amountUSDT,
                amountVND: paymentData.amountVND,
                transactionRef,
                usdtTransactionId: paymentData.usdtTransactionId,
            }),
            {
                parse_mode: "Markdown",
                reply_markup: telegramKeyboards.paymentConfirmation(),
            }
        );

        console.log(`User ${paymentData.userId} notified about completed payment`);
    } catch (error) {
        console.error(`Failed to notify user about completed payment:`, error);
    }
}

/**
 * Notify the admin about a completed payment
 */
async function notifyAdmin(
    bot: Telegraf<Scenes.SceneContext>,
    paymentId: string,
    paymentData: Record<string, string>,
    transactionRef: string
): Promise<void> {
    if (!Config.adminChatId) {
        return;
    }

    try {
        await bot.telegram.sendMessage(
            Config.adminChatId,
            telegramTemplates.adminPaymentNotification({
                paymentId,
                amountUSDT: paymentData.amountUSDT,
                amountVND: paymentData.amountVND,
                userId: paymentData.userId,
                email: paymentData.email,
                transactionRef,
            })
        );
    } catch (error) {
        console.error("Failed to notify admin about completed payment", error);
    }
}

/**
 * Notify the admin about a failed USDT transfer
 */
async function notifyAdminOfError(
    bot: Telegraf<Scenes.SceneContext>,
    paymentId: string,
    paymentData: Record<string, string>,
    error: Error
): Promise<void> {
    if (!Config.adminChatId) {
        return;
    }

    try {
        await bot.telegram.sendMessage(
            Config.adminChatId,
            `❌ Error: Failed to process USDT transfer for payment ${paymentId}.\n` +
                `VND payment received, but USDT transfer failed.\n` +
                `Amount: ${paymentData.amountUSDT} USDT\n` +
                `User: ${paymentData.userId}\n` +
                `Email: ${paymentData.email}\n` +
                `Error: ${error.message}`
        );
    } catch (notifyError) {
        console.error("Failed to notify admin about USDT transfer error", notifyError);
    }
}

/**
 * Process USDT transfer using Basal Pay API
 */
async function processUsdtTransfer(
    bot: Telegraf<Scenes.SceneContext>,
    redis: Redis,
    redisHelper: RedisHelper,
    paymentId: string,
    paymentData: Record<string, string>
): Promise<void> {
    // Get recipient's user ID, lookup by email if not provided
    let recipientUserId = "";

    if (paymentData.email) {
        const userId = await basalPayService.getUserByEmail(paymentData.email);
        if (userId) {
            recipientUserId = userId;
            // Save for future reference
            await redisHelper.setHash(`payment:${paymentId}`, { recipientUserId: userId });
        }
    }

    if (!recipientUserId) {
        throw new Error("Could not determine recipient user ID for USDT transfer");
    }

    // Check if we have enough USDT balance before proceeding
    const hasSufficientBalance = await basalPayService.hasSufficientBalance(paymentData.amountUSDT);
    if (!hasSufficientBalance) {
        throw new Error(
            `Insufficient USDT balance to process transfer of ${paymentData.amountUSDT} USDT`
        );
    }

    // Prepare transfer request
    const transferRequest = {
        toUserId: recipientUserId,
        amount: paymentData.amountUSDT,
        currencyId: "usdt",
        memo: `P2P Payment ID: ${paymentId.substring(0, 8)}`,
        fundPassword: Config.basalPay.fundPassword,
    };

    // Execute the transfer
    const transferResult = await basalPayService.transferUsdt(transferRequest);

    // Update payment record
    await redisHelper.updatePaymentStatus(paymentId, "completed", {
        usdtTransactionId: transferResult.data.id,
        usdtTransactionStatus: transferResult.data.status,
    });

    // Update payment sets
    await redisHelper.completePayment(paymentId);

    console.log(
        `USDT transfer completed for payment ${paymentId}: ${paymentData.amountUSDT} USDT to ${recipientUserId}`
    );
}
