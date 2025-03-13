import { Telegraf, Scenes, session } from "telegraf";
import { message } from "telegraf/filters";
import Redis from "ioredis";
import { v4 as uuidv4 } from "uuid";
import cron from "node-cron";

import { p2pPaymentScene } from "./scenes/p2p-payment";
import { getBinanceP2PRate } from "./services/binance-service";
import { setupTransactionMonitor } from "./services/transaction-monitor";
import { botConfig } from "./config";
import { BankService } from "./services/bank.service";

// Initialize Redis
const redis = new Redis(botConfig.redis.url);

// Initialize Telegram bot
const bot = new Telegraf<Scenes.SceneContext>(botConfig.telegram.token);

/**
 * Initialize and start the Telegram bot
 * @param bankService The initialized bank service instance
 */
export async function initBot(bankService: BankService) {
    try {
        // Register scenes
        const stage = new Scenes.Stage<Scenes.SceneContext>([p2pPaymentScene]);
        bot.use(session());
        bot.use(stage.middleware());

        // Start command
        bot.start(async (ctx) => {
            try {
                const welcomeMessage = `👋 Welcome to ${botConfig.botName}!

I can help you make P2P payments quickly and securely.`;

                await ctx.reply(welcomeMessage, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "💰 P2P Payment", callback_data: "p2p_payment" }],
                            [{ text: "📞 Support", callback_data: "support" }]
                        ]
                    },
                });

                // Store user info in Redis
                const userId = ctx.from.id.toString();
                const username = ctx.from.username || "";
                const firstName = ctx.from.first_name || "";
                const lastName = ctx.from.last_name || "";

                await redis.hset(`user:${userId}`, {
                    username,
                    firstName,
                    lastName,
                    lastActive: Date.now(),
                });

                console.log(`New user started bot: ${userId} (${username || firstName})`);
            } catch (error) {
                console.error("Error in start command:", error);
                ctx.reply("Sorry, there was an error starting the bot. Please try again later.");
            }
        });

        // Help command
        bot.help((ctx) => {
            ctx.reply(`${botConfig.botName} Help:

/start - Start the bot
/p2p - Start a P2P payment
/status - Check your payment status
/support - Contact support
/help - Show this help message`);
        });

        // Handle P2P Payment inline button click
        bot.action("p2p_payment", (ctx) => {
            ctx.answerCbQuery();
            ctx.scene.enter("p2p-payment");
        });

        // Handle support inline button
        bot.action("support", (ctx) => {
            ctx.answerCbQuery();
            ctx.reply(`For support, please contact @${botConfig.supportUsername}`);
        });
        
        // Handle copy buttons
        bot.action(/^copy_account_(.+)$/, async (ctx) => {
            if (ctx.callbackQuery && 'data' in ctx.callbackQuery) {
                const match = ctx.callbackQuery.data.match(/^copy_account_(.+)$/);
                if (match) {
                    const accountNumber = match[1];
                    await ctx.answerCbQuery(`Account number ${accountNumber} copied to clipboard`);
                }
            }
        });
        
        bot.action(/^copy_memo_(.+)$/, async (ctx) => {
            if (ctx.callbackQuery && 'data' in ctx.callbackQuery) {
                const match = ctx.callbackQuery.data.match(/^copy_memo_(.+)$/);
                if (match) {
                    const memo = match[1];
                    await ctx.answerCbQuery(`Memo ${memo} copied to clipboard`);
                }
            }
        });
        
        bot.action(/^copy_amount_(.+)$/, async (ctx) => {
            if (ctx.callbackQuery && 'data' in ctx.callbackQuery) {
                const match = ctx.callbackQuery.data.match(/^copy_amount_(.+)$/);
                if (match) {
                    const amount = match[1];
                    await ctx.answerCbQuery(`Amount ${parseInt(amount).toLocaleString("vi-VN")} VND copied to clipboard`);
                }
            }
        });
        
        // Handle show payment details action
        bot.action(/^show_payment_(.+)$/, async (ctx) => {
            if (ctx.callbackQuery && 'data' in ctx.callbackQuery) {
                const match = ctx.callbackQuery.data.match(/^show_payment_(.+)$/);
                if (match) {
                    const paymentId = match[1];
                    const paymentData = await redis.hgetall(`payment:${paymentId}`);
        
                    if (!paymentData || Object.keys(paymentData).length === 0) {
                        await ctx.answerCbQuery("Payment not found");
                        return;
                    }
        
                    // Regenerate the payment details message
                    const amountUSDT = parseFloat(paymentData.amountUSDT);
                    const amountVND = parseInt(paymentData.amountVND);
                    const rate = parseFloat(paymentData.rate);
                    const memo = paymentData.memo;
                    const expiryMinutes = botConfig.payment.expiryMinutes;
        
                    // Create payment instructions message with clickable copy buttons
                    const instructionMessage = `💳 *Payment Details*\n\n` +
                        `📊 *Transaction Information:*\n` +
                        `• Amount: ${amountUSDT} USDT\n` +
                        `• VND Amount: ${amountVND.toLocaleString("vi-VN")} VND\n` +
                        `• Rate: ${rate.toLocaleString("vi-VN")} VND/USDT\n\n` +
                        `🏦 *Transfer Details:*\n` +
                        `\`\`\`\n` +
                        `BANK:   ${botConfig.bank.name}\n` +
                        `ACCOUNT: ${botConfig.bank.accountNumber}\n` +
                        `NAME:   ${botConfig.bank.accountName}\n` +
                        `MEMO:   ${memo}\n` +
                        `\`\`\`\n\n` +
                        `⚠️ IMPORTANT: You MUST include the memo code in your transfer description!\n\n` +
                        `Payment ID: ${paymentId.substring(0, 8)}${paymentData.status === "pending" ? 
                        `\n⏱ This payment request will expire in ${expiryMinutes} minutes.` : 
                        `\nStatus: ${paymentData.status}`}\n\n` +
                        `We'll automatically notify you once the payment is confirmed.`;
        
                    // Edit the original message to show payment details again
                    await ctx.editMessageText(instructionMessage, {
                        parse_mode: "Markdown",
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: "📋 Copy Account Number", callback_data: `copy_account_${botConfig.bank.accountNumber}` },
                                    { text: "📋 Copy Memo", callback_data: `copy_memo_${memo}` }
                                ],
                                [
                                    { text: "📋 Copy Amount", callback_data: `copy_amount_${amountVND}` },
                                    { text: "📊 Check Status", callback_data: `check_status_${paymentId}` }
                                ],
                                [
                                    { text: "💰 New Payment", callback_data: "p2p_payment" },
                                    { text: "📞 Support", callback_data: "support" }
                                ],
                            ],
                        },
                    });
                    await ctx.answerCbQuery("Payment details shown");
                }
            }
        });
        
        // Handle check status action
        bot.action(/^check_status_(.+)$/, async (ctx) => {
            if (ctx.callbackQuery && 'data' in ctx.callbackQuery) {
                const match = ctx.callbackQuery.data.match(/^check_status_(.+)$/);
                if (match) {
                    const paymentId = match[1];
                    const paymentData = await redis.hgetall(`payment:${paymentId}`);
        
                    if (!paymentData || Object.keys(paymentData).length === 0) {
                        await ctx.answerCbQuery("Payment not found");
                        return;
                    }
        
                    const statusMessage = `📝 *Payment Status*\n\n` +
                        `Payment ID: ${paymentId.substring(0, 8)}\n` +
                        `Amount: ${paymentData.amountUSDT} USDT (${parseInt(paymentData.amountVND).toLocaleString("vi-VN")} VND)\n` +
                        `Status: ${paymentData.status}\n` +
                        `Created: ${new Date(parseInt(paymentData.createdAt)).toLocaleString()}\n` +
                        `${paymentData.status === "pending" ? 
                            `Expires: ${new Date(parseInt(paymentData.expiresAt)).toLocaleString()}` : 
                            ""}\n`;
        
                    // Edit the original message to show status instead of creating a new one
                    await ctx.editMessageText(statusMessage, {
                        parse_mode: "Markdown",
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "↩️ Back to Payment", callback_data: `show_payment_${paymentId}` }],
                                [{ text: "💰 New Payment", callback_data: "p2p_payment" }],
                                [{ text: "📞 Support", callback_data: "support" }]
                            ],
                        },
                    });
                    await ctx.answerCbQuery("Payment status updated");
                }
            }
        });

        // Direct commands to scene
        bot.command("p2p", (ctx) => {
            ctx.scene.enter("p2p-payment");
        });

        // Status command
        bot.command("status", async (ctx) => {
            const userId = ctx.from.id.toString();

            try {
                // Get active payment for the user
                const paymentId = await redis.get(`user:${userId}:activePayment`);

                if (!paymentId) {
                    return ctx.reply("You have no active payments.");
                }

                const paymentData = await redis.hgetall(`payment:${paymentId}`);

                if (!paymentData || Object.keys(paymentData).length === 0) {
                    return ctx.reply("Payment information not found.");
                }

                const statusMessage = `📝 *Payment Status*

Payment ID: ${paymentId.substring(0, 8)}
Amount: ${paymentData.amountUSDT} USDT (${paymentData.amountVND} VND)
Status: ${paymentData.status}
Created: ${new Date(parseInt(paymentData.createdAt)).toLocaleString()}
${
    paymentData.status === "pending"
        ? `Expires: ${new Date(parseInt(paymentData.expiresAt)).toLocaleString()}`
        : ""
}`;

                await ctx.replyWithMarkdown(statusMessage, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "↩️ View Payment Details", callback_data: `show_payment_${paymentId}` }],
                            [{ text: "💰 P2P Payment", callback_data: "p2p_payment" }],
                            [{ text: "📞 Support", callback_data: "support" }]
                        ]
                    }
                });
            } catch (error) {
                console.error("Error checking payment status:", error);
                ctx.reply("Sorry, there was an error checking your payment status.");
            }
        });

        // Support command
        bot.command("support", (ctx) => {
            ctx.reply(`For support, please contact @${botConfig.supportUsername}`);
        });

        // Handle unknown text
        bot.on(message("text"), (ctx) => {
            ctx.reply(
                "Sorry, I didn't understand that. Please use the inline buttons or type /help for assistance.",
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "💰 P2P Payment", callback_data: "p2p_payment" }],
                            [{ text: "📞 Support", callback_data: "support" }]
                        ]
                    },
                }
            );
        });

        // Setup transaction monitoring with the provided bank service
        setupTransactionMonitor(bot, redis, bankService);

        // Setup cleanup job for expired payments (runs every hour)
        cron.schedule("0 * * * *", async () => {
            try {
                const now = Date.now();
                const expiredPayments = await redis.zrangebyscore("payments:expiry", 0, now);

                for (const paymentId of expiredPayments) {
                    const paymentData = await redis.hgetall(`payment:${paymentId}`);

                    if (paymentData && paymentData.status === "pending") {
                        // Update payment status
                        await redis.hset(`payment:${paymentId}`, "status", "expired");

                        // Notify user if possible
                        if (paymentData.userId) {
                            try {
                                await bot.telegram.sendMessage(
                                    paymentData.userId,
                                    `⚠️ *Payment Expired*\n\n` +
                                    `Your payment #${paymentId.substring(0, 8)} for ${paymentData.amountUSDT} USDT has expired.\n\n` +
                                    `If you still want to make this payment, please start a new payment transaction.`,
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
                            } catch (error) {
                                console.error(
                                    `Failed to notify user about expired payment: ${paymentId}`,
                                    error
                                );
                            }
                        }

                        // Remove from expiry set
                        await redis.zrem("payments:expiry", paymentId);

                        console.log(`Payment expired: ${paymentId}`);
                    }
                }
            } catch (error) {
                console.error("Error in expired payments cleanup job:", error);
            }
        });

        // Error handling
        bot.catch((err, ctx) => {
            console.error(`Error in bot update ${ctx.update.update_id}:`, err);
            ctx.reply("An error occurred while processing your request. Please try again later.");
        });

        // Start the bot
        await bot.launch();
        console.log(`Bot started as @${bot.botInfo?.username}`);

        // Enable graceful shutdown
        process.once("SIGINT", () => bot.stop("SIGINT"));
        process.once("SIGTERM", () => bot.stop("SIGTERM"));

        return bot;
    } catch (error) {
        console.error("Failed to initialize bot:", error);
        throw error;
    }
}
