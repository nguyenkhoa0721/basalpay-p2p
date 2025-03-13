import { Telegraf } from "telegraf";
import { Scenes } from "telegraf";
import Redis from "ioredis";
import moment from "moment";

import { botConfig } from "../config";
import { BankService } from "./bank.service";

/**
 * Sets up the transaction monitoring service
 *
 * @param {Telegraf<Scenes.SceneContext>} bot Telegram bot instance
 * @param {Redis} redis Redis client instance
 * @param {BankService} bankService Initialized bank service instance
 */
export function setupTransactionMonitor(
    bot: Telegraf<Scenes.SceneContext>,
    redis: Redis,
    bankService: BankService
): void {
    // Set interval for checking transactions
    setInterval(async () => {
        try {
            await checkTransactions(bot, redis, bankService);
        } catch (error) {
            console.error("Error in transaction check cycle:", error);

            // If login expired, try to re-login
            if (error instanceof Error && error.message.includes("GW200")) {
                try {
                    await bankService.login();
                    console.log("Re-logged in to MB Bank after session expiry");
                } catch (loginError) {
                    console.error("Failed to re-login to MB Bank:", loginError);
                }
            }
        }
    }, botConfig.transactionCheck.intervalMs);

    console.log(
        `Transaction monitoring started (checking every ${
            botConfig.transactionCheck.intervalMs / 1000
        } seconds)`
    );
}

/**
 * Checks for new transactions and matches them to pending payments
 *
 * @param {Telegraf<Scenes.SceneContext>} bot Telegram bot instance
 * @param {Redis} redis Redis client instance
 * @param {BankService} bankService Bank service instance
 */
async function checkTransactions(
    bot: Telegraf<Scenes.SceneContext>,
    redis: Redis,
    bankService: BankService
): Promise<void> {
    console.log(`[${new Date().toISOString()}] Running transaction check...`);
    // Get bank account info
    const balance = await bankService.getBalance();

    if (!balance || !balance.balances || balance.balances.length === 0) {
        console.error("Could not retrieve account balance");
        return;
    }

    // Find the main account
    const account = balance.balances.find((acc) => acc.number === botConfig.bank.accountNumber);

    if (!account) {
        console.error(`Account ${botConfig.bank.accountNumber} not found in balance list`);
        return;
    }

    // Get transaction history for the past hour
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

    // Process only credit transactions (using integer amounts)
    const creditTransactions = transactions.filter(
        (tx) => tx.creditAmount && parseInt(tx.creditAmount) > 0
    );

    // Get all pending payments
    const pendingPaymentIds = await redis.smembers("payments:pending");

    // For each pending payment, check for matching transactions
    for (const paymentId of pendingPaymentIds) {
        try {
            const paymentData = await redis.hgetall(`payment:${paymentId}`);

            if (!paymentData || !paymentData.status || paymentData.status !== "pending") {
                continue;
            }

            const amountVND = parseInt(paymentData.amountVND);
            const memo = paymentData.memo;

            // Look for matching transactions (by amount and memo)
            const matchingTransaction = creditTransactions.find((tx) => {
                const txAmount = parseInt(tx.creditAmount);
                // Check if transaction has the memo in the description (memo is now numeric)
                const hasMemo = tx.transactionDesc && tx.transactionDesc.includes(memo);

                // Check if amount matches (must be exact since we're using integers)
                const amountMatches = txAmount === amountVND;

                return hasMemo && amountMatches;
            });

            if (matchingTransaction) {
                // Update payment status to completed
                await redis.hset(`payment:${paymentId}`, {
                    status: "completed",
                    completedAt: Date.now().toString(),
                    transactionRef: matchingTransaction.refNo,
                });

                // Remove from pending payments set
                await redis.srem("payments:pending", paymentId);

                // Add to completed payments set
                await redis.sadd("payments:completed", paymentId);

                // Notify the user
                if (paymentData.userId) {
                    try {
                        await bot.telegram.sendMessage(
                            paymentData.userId,
                            `✅ *Payment Confirmed*\n\n` +
                            `Your payment of *${paymentData.amountUSDT} USDT* has been received and confirmed!\n\n` +
                            `*Transaction Details:*\n` +
                            `• Reference: ${matchingTransaction.refNo}\n` +
                            `• Amount: ${parseInt(paymentData.amountVND).toLocaleString("vi-VN")} VND\n` +
                            `• Status: Completed\n\n` +
                            `Thank you for using our service.`,
                            {
                                parse_mode: "Markdown",
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: "💰 New Payment", callback_data: "p2p_payment" }],
                                        [{ text: "📞 Support", callback_data: "support" }]
                                    ]
                                }
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

                // Also notify admin if configured
                if (botConfig.adminChatId) {
                    try {
                        await bot.telegram.sendMessage(
                            botConfig.adminChatId,
                            `💰 Payment confirmed!\n\nID: ${paymentId}\nAmount: ${paymentData.amountUSDT} USDT (${paymentData.amountVND} VND)\nUser: ${paymentData.userId}\nEmail: ${paymentData.email}\nTransaction: ${matchingTransaction.refNo}`
                        );
                    } catch (adminNotifyError) {
                        console.error(
                            "Failed to notify admin about completed payment",
                            adminNotifyError
                        );
                    }
                }
            }
        } catch (paymentError) {
            console.error(`Error processing payment ${paymentId}:`, paymentError);
        }
    }
}
