import { Telegraf } from "telegraf";
import { Scenes } from "telegraf";
import Redis from "ioredis";
import moment from "moment";
import { BankService } from "./bank.service";
import { BasalPayService } from "./basal-pay.service";
import { telegramTemplates, telegramKeyboards } from "../utils/messages/telegram-templates";
import { Config } from "../config";

// Initialize the Basal Pay service
const basalPayService = new BasalPayService();

export function setupTransactionMonitor(
    bot: Telegraf<Scenes.SceneContext>,
    redis: Redis,
    bankService: BankService
): void {
    setInterval(async () => {
        try {
            await checkTransactions(bot, redis, bankService);
        } catch (error) {
            console.error("Error in transaction check cycle:", error);

            if (error instanceof Error && error.message.includes("GW200")) {
                try {
                    await bankService.login();
                    console.log("Re-logged in to MB Bank after session expiry");
                } catch (loginError) {
                    console.error("Failed to re-login to MB Bank:", loginError);
                }
            }
        }
    }, Config.transactionCheck.intervalMs);

    console.log(
        `Transaction monitoring started (checking every ${
            Config.transactionCheck.intervalMs / 1000
        } seconds)`
    );
}

async function checkTransactions(
    bot: Telegraf<Scenes.SceneContext>,
    redis: Redis,
    bankService: BankService
): Promise<void> {
    console.log(`[${new Date().toISOString()}] Running transaction check...`);
    const balance = await bankService.getBalance();

    if (!balance || !balance.balances || balance.balances.length === 0) {
        console.error("Could not retrieve account balance");
        return;
    }

    const account = balance.balances.find((acc) => acc.number === Config.bank.accountNumber);

    if (!account) {
        console.error(`Account ${Config.bank.accountNumber} not found in balance list`);
        return;
    }

    const fromDate = moment().subtract(1, "hour");
    const toDate = moment();

    const transactions = await bankService.getTransactionsHistory({
        accountNumber: account.number,
        fromDate,
        toDate,
    });

    if (!transactions || transactions.length === 0) {
        return;
    }

    console.log(`Found ${transactions.length} recent transactions`);

    const creditTransactions = transactions.filter(
        (tx) => tx.creditAmount && parseInt(tx.creditAmount) > 0
    );

    const pendingPaymentIds = await redis.smembers("payments:pending");

    for (const paymentId of pendingPaymentIds) {
        try {
            const paymentData = await redis.hgetall(`payment:${paymentId}`);

            if (!paymentData || !paymentData.status || paymentData.status !== "pending") {
                continue;
            }

            const amountVND = parseInt(paymentData.amountVND);
            const memo = paymentData.memo;

            const matchingTransaction = creditTransactions.find((tx) => {
                const txAmount = parseInt(tx.creditAmount);
                const hasMemo = tx.transactionDesc && tx.transactionDesc.includes(memo);

                const amountMatches = txAmount === amountVND;

                return hasMemo && amountMatches;
            });

            if (matchingTransaction) {
                await redis.hset(`payment:${paymentId}`, {
                    status: "processing",
                    vndReceivedAt: Date.now().toString(),
                    transactionRef: matchingTransaction.refNo,
                });

                // Send USDT to the user via Basal Pay
                try {
                    // Only send USDT if we haven't already done so
                    if (!paymentData.usdtTransactionId) {
                        const amountUSDT = parseFloat(paymentData.amountUSDT);

                        // Process the USDT transfer via Basal Pay
                        await processUsdtTransfer(bot, redis, paymentId, paymentData);
                    } else {
                        // USDT was already sent, just update status
                        await redis.hset(`payment:${paymentId}`, {
                            status: "completed",
                            completedAt: Date.now().toString(),
                        });

                        await redis.srem("payments:pending", paymentId);
                        await redis.sadd("payments:completed", paymentId);
                    }

                    // Notify the user about the completed payment
                    if (paymentData.userId) {
                        try {
                            await bot.telegram.sendMessage(
                                paymentData.userId,
                                telegramTemplates.paymentConfirmed({
                                    amountUSDT: paymentData.amountUSDT,
                                    amountVND: paymentData.amountVND,
                                    transactionRef: matchingTransaction.refNo,
                                    usdtTransactionId: paymentData.usdtTransactionId,
                                }),
                                {
                                    parse_mode: "Markdown",
                                    reply_markup: telegramKeyboards.paymentConfirmation(),
                                }
                            );

                            console.log(
                                `Payment ${paymentId} confirmed and user ${paymentData.userId} notified`
                            );
                        } catch (notifyError) {
                            console.error(
                                `Failed to notify user about completed payment: ${paymentId}`,
                                notifyError
                            );
                        }
                    }

                    // Notify admin about the completed payment
                    if (Config.adminChatId) {
                        try {
                            await bot.telegram.sendMessage(
                                Config.adminChatId,
                                telegramTemplates.adminPaymentNotification({
                                    paymentId,
                                    amountUSDT: paymentData.amountUSDT,
                                    amountVND: paymentData.amountVND,
                                    userId: paymentData.userId,
                                    email: paymentData.email,
                                    transactionRef: matchingTransaction.refNo,
                                })
                            );
                        } catch (adminNotifyError) {
                            console.error(
                                "Failed to notify admin about completed payment",
                                adminNotifyError
                            );
                        }
                    }
                } catch (usdtError: any) {
                    console.error(
                        `Error processing USDT transfer for payment ${paymentId}:`,
                        usdtError
                    );

                    // Notify admin about the failed USDT transfer
                    if (Config.adminChatId) {
                        try {
                            await bot.telegram.sendMessage(
                                Config.adminChatId,
                                `❌ Error: Failed to process USDT transfer for payment ${paymentId}.\nVND payment received, but USDT transfer failed.\nAmount: ${paymentData.amountUSDT} USDT\nUser: ${paymentData.userId}\nError: ${usdtError.message}`
                            );
                        } catch (notifyError) {
                            console.error(
                                "Failed to notify admin about USDT transfer error",
                                notifyError
                            );
                        }
                    }

                    // Mark payment as requiring manual attention
                    await redis.hset(`payment:${paymentId}`, {
                        status: "manual_review",
                        error: usdtError.message,
                    });
                }
            }
        } catch (paymentError) {
            console.error(`Error processing payment ${paymentId}:`, paymentError);
        }
    }
}

/**
 * Process USDT transfer using Basal Pay API
 */
async function processUsdtTransfer(
    bot: Telegraf<Scenes.SceneContext>,
    redis: Redis,
    paymentId: string,
    paymentData: Record<string, string>
): Promise<void> {
    try {
        // Check if we have a recipient userId, if not try to get it from the email
        let recipientUserId = "";

        if (paymentData.email) {
            // Try to find the user by email
            const userId = await basalPayService.getUserByEmail(paymentData.email);
            if (userId) {
                recipientUserId = userId;
                // Save the userId for future reference
                await redis.hset(`payment:${paymentId}`, {
                    recipientUserId: userId,
                });
            }
        }

        if (!recipientUserId) {
            throw new Error("No recipient user ID specified for USDT transfer");
        }

        // Transfer USDT to the recipient
        const transferRequest = {
            toUserId: recipientUserId,
            amount: paymentData.amountUSDT,
            currencyId: "usdt",
            memo: `P2P Payment ID: ${paymentId.substring(0, 8)}`,
            fundPassword: Config.basalPay.fundPassword,
        };

        // Execute the transfer
        const transferResult = await basalPayService.transferUsdt(transferRequest);

        // Update payment record with USDT transaction details
        await redis.hset(`payment:${paymentId}`, {
            status: "completed",
            completedAt: Date.now().toString(),
            usdtTransactionId: transferResult.data.id,
            usdtTransactionStatus: transferResult.data.status,
        });

        // Update payment sets
        await redis.srem("payments:pending", paymentId);
        await redis.sadd("payments:completed", paymentId);

        console.log(
            `USDT transfer completed for payment ${paymentId}: ${paymentData.amountUSDT} USDT to ${recipientUserId}`
        );

        return;
    } catch (error) {
        console.error("Error transferring USDT:", error);
        throw error;
    }
}
