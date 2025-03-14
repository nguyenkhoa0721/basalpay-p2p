import { Telegraf, Scenes, session } from "telegraf";
import { message } from "telegraf/filters";
import Redis from "ioredis";
import cron from "node-cron";

import { p2pPaymentScene } from "./scenes/p2p-payment";
import { setupTransactionMonitor } from "./services/transaction-monitor";
import { Config } from "./config";
import { BankService } from "./services/bank.service";
import { BasalPayService } from "./services/basal-pay.service";
import { RedisHelper } from "./utils/redis-helper";
import { telegramTemplates, telegramKeyboards } from "./utils/messages/telegram-templates";
import { isWithinOperatingHours, getOperatingHoursMessage } from "./utils/time-helper";

const redis = new Redis(Config.redis.url);

// Define a global error handler function for Redis operations
async function safeRedisOperation<T>(
    operation: () => Promise<T>,
    fallback: T,
    errorMessage: string
): Promise<T> {
    try {
        return await operation();
    } catch (error) {
        console.error(errorMessage, error);
        return fallback;
    }
}

/**
 * Initialize and start the Telegram bot
 */
export async function initBot(bankService: BankService, redis: Redis, redisHelper: RedisHelper) {
    try {
        // Create bot instance
        const bot = new Telegraf<Scenes.SceneContext>(Config.telegram.token);

        // Add operating hours middleware
        bot.use(async (ctx, next) => {
            // Skip middleware for start and help commands
            if (ctx.updateType === 'message') {
                if (ctx.message && 'text' in ctx.message) {
                    const text = ctx.message.text;
                    if (text === '/start' || text === '/help' || text === '/status' || text === '/support') {
                        return next();
                    }
                }
            }
            
            // Allow admins to bypass time restriction if configured
            if (Config.adminChatId && ctx.from && ctx.from.id.toString() === Config.adminChatId) {
                return next();
            }
            
            // Check if we're within operating hours
            if (!isWithinOperatingHours()) {
                await ctx.reply(
                    `⛔ Sorry, we are currently outside operating hours.\n\n` +
                    `Our service is available from 9:00 AM to 12:00 AM (midnight) Vietnam time only.\n\n` +
                    getOperatingHoursMessage()
                );
                return;
            }
            
            return next();
        });

        // Set up scenes/stages
        const stage = new Scenes.Stage<Scenes.SceneContext>([p2pPaymentScene]);
        bot.use(session());
        bot.use(stage.middleware());

        // Register command handlers
        registerCommands(bot);

        // Register action handlers
        registerActions(bot, redis);

        // Set up transaction monitor
        setupTransactionMonitor(bot, redis, redisHelper, bankService);

        // Set up expired payments cleanup job
        setupExpiryJob(bot, redis, redisHelper);

        // Global error handler
        bot.catch((err, ctx) => {
            console.error(`Error in bot update ${ctx.update.update_id}:`, err);
            ctx.reply("An error occurred while processing your request. Please try again later.");
        });

        // Start the bot
        await bot.launch();
        console.log(`Bot started as @${bot.botInfo?.username}`);

        // Graceful shutdown
        process.once("SIGINT", () => bot.stop("SIGINT"));
        process.once("SIGTERM", () => bot.stop("SIGTERM"));

        return bot;
    } catch (error) {
        console.error("Failed to initialize bot:", error);
        throw error;
    }
}

/**
 * Register command handlers
 */
function registerCommands(bot: Telegraf<Scenes.SceneContext>) {
    // /start command
    bot.start(async (ctx) => {
        try {
            const userId = ctx.from.id.toString();
            const username = ctx.from.username || "";
            const firstName = ctx.from.first_name || "";
            const lastName = ctx.from.last_name || "";
            
            // Initialize BasalPay service to get USDT balance
            const basalPayService = new BasalPayService();
            let usdtBalance = "";
            
            try {
                usdtBalance = await basalPayService.getUsdtBalance();
            } catch (error) {
                console.error("Error fetching USDT balance:", error);
                // Continue without balance if we can't fetch it
            }
            
            // Generate welcome message with balance info
            const welcomeMessage = telegramTemplates.welcome(usdtBalance);
            
            // Display operating hours status
            const operatingHoursMessage = getOperatingHoursMessage();
            
            // Send welcome message
            await ctx.reply(welcomeMessage, {
                parse_mode: "Markdown",
                reply_markup: telegramKeyboards.mainMenu(),
            });
            
            // Send operating hours status as a separate message
            await ctx.reply(operatingHoursMessage);

            // Save user info
            await redis.hset(`user:${userId}`, {
                username,
                firstName,
                lastName,
                lastActive: Date.now(),
            });

            console.log(`User started bot: ${userId} (${username || firstName})`);
        } catch (error) {
            console.error("Error in start command:", error);
            ctx.reply("Sorry, there was an error starting the bot. Please try again later.");
        }
    });

    // /help command
    bot.help(async (ctx) => {
        await ctx.reply(telegramTemplates.help(), { parse_mode: "Markdown" });
        await ctx.reply(getOperatingHoursMessage());
    });

    // /p2p command
    bot.command("p2p", (ctx) => {
        ctx.scene.enter("p2p-payment");
    });

    // /status command
    bot.command("status", async (ctx) => {
        const userId = ctx.from.id.toString();

        try {
            const paymentId = await redis.get(`user:${userId}:activePayment`);

            if (!paymentId) {
                return ctx.reply("You have no active payments.");
            }

            const paymentData = await redis.hgetall(`payment:${paymentId}`);

            if (!paymentData || Object.keys(paymentData).length === 0) {
                return ctx.reply("Payment information not found.");
            }

            const statusMessage = telegramTemplates.paymentStatus({
                paymentId,
                amountUSDT: paymentData.amountUSDT,
                amountVND: paymentData.amountVND,
                status: paymentData.status,
                createdAt: paymentData.createdAt,
                expiresAt: paymentData.expiresAt,
            });

            await ctx.replyWithMarkdown(statusMessage, {
                reply_markup: telegramKeyboards.paymentStatus({ paymentId }),
            });
        } catch (error) {
            console.error("Error checking payment status:", error);
            ctx.reply("Sorry, there was an error checking your payment status.");
        }
    });

    // /system command - admin only
    bot.command("system", async (ctx) => {
        const userId = ctx.from.id.toString();
        
        // Check if user is admin
        if (Config.adminChatId && userId === Config.adminChatId) {
            try {
                // Get USDT balance
                const basalPayService = new BasalPayService();
                let usdtBalance = "Unknown";
                
                try {
                    usdtBalance = await basalPayService.getUsdtBalance();
                } catch (error) {
                    console.error("Error fetching USDT balance:", error);
                }
                
                // Get pending payments count
                const pendingCount = await redis.scard("payments:pending");
                
                // Get completed payments count
                const completedCount = await redis.scard("payments:completed");
                
                // Get operating hours status
                const operatingHoursStatus = isWithinOperatingHours() ? "🟢 Active" : "🔴 Inactive";
                
                const message = (
                    `📡 *System Status*\n\n` +
                    `💰 USDT Balance: *${usdtBalance}*\n` +
                    `⏰ Operating Hours: ${operatingHoursStatus}\n` +
                    `⏳ Pending Payments: ${pendingCount}\n` +
                    `✅ Completed Payments: ${completedCount}\n\n` +
                    `${getOperatingHoursMessage()}`
                );
                
                await ctx.reply(message, { parse_mode: "Markdown" });
            } catch (error) {
                console.error("Error in system command:", error);
                await ctx.reply("Error fetching system status");
            }
        } else {
            await ctx.reply("Sorry, this command is only available to administrators.");
        }
    });

    // /support command
    bot.command("support", (ctx) => {
        ctx.reply(telegramTemplates.support());
    });

    // Fallback for unknown text messages
    bot.on(message("text"), (ctx) => {
        ctx.reply(
            "Sorry, I didn't understand that. Please use the buttons or type /help for assistance.",
            {
                reply_markup: telegramKeyboards.mainMenu(),
            }
        );
    });
}

/**
 * Register action handlers for inline buttons
 */
function registerActions(bot: Telegraf<Scenes.SceneContext>, redis: Redis) {
    // P2P payment button
    bot.action("p2p_payment", async (ctx) => {
        try {
            await ctx.answerCbQuery();
            await ctx.scene.enter("p2p-payment");
        } catch (error) {
            console.error("Error entering p2p-payment scene:", error);
            await ctx.reply(
                "Sorry, there was an error starting the payment process. Please try again."
            );
        }
    });

    // Support button
    bot.action("support", async (ctx) => {
        try {
            await ctx.answerCbQuery();
            await ctx.reply(telegramTemplates.support());
        } catch (error) {
            console.error("Error handling support action:", error);
        }
    });

    // Show payment details button
    bot.action(/^show_payment_(.+)$/, async (ctx) => {
        try {
            if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) {
                return;
            }

            const match = ctx.callbackQuery.data.match(/^show_payment_(.+)$/);
            if (!match) return;

            const paymentId = match[1];
            const paymentData = await redis.hgetall(`payment:${paymentId}`);

            if (!paymentData || Object.keys(paymentData).length === 0) {
                await ctx.answerCbQuery("Payment not found");
                return;
            }

            // Safe parsing of numeric values
            const amountUSDT = parseFloat(paymentData.amountUSDT || "0");
            const amountVND = parseInt(paymentData.amountVND || "0");
            const rate = parseFloat(paymentData.rate || "0");
            const memo = paymentData.memo || "";
            const expiryMinutes = Config.payment.expiryMinutes;

            // Check for invalid data
            if (isNaN(amountUSDT) || isNaN(amountVND) || isNaN(rate) || !memo) {
                console.error(`Invalid payment data for ${paymentId}:`, paymentData);
                await ctx.answerCbQuery("Payment data is invalid");
                return;
            }

            const instructionMessage = telegramTemplates.paymentDetails({
                amountUSDT,
                amountVND,
                rate,
                memo,
                paymentId,
                expiryMinutes,
                status: paymentData.status || "unknown",
            });

            await ctx.editMessageText(instructionMessage, {
                parse_mode: "Markdown",
                reply_markup: telegramKeyboards.paymentDetails({
                    accountNumber: Config.bank.accountNumber,
                    memo,
                    amountVND,
                    paymentId,
                }),
            });

            await ctx.answerCbQuery("Payment details shown");
        } catch (error) {
            console.error("Error showing payment details:", error);
            try {
                await ctx.answerCbQuery("Error retrieving payment details");
            } catch (e) {
                // Ignore additional errors in error handling
            }
        }
    });

    // Check payment status button
    bot.action(/^payment_status_(.+)$/, async (ctx) => {
        try {
            if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) {
                return;
            }

            const match = ctx.callbackQuery.data.match(/^payment_status_(.+)$/);
            if (!match) return;

            const paymentId = match[1];
            const paymentData = await redis.hgetall(`payment:${paymentId}`);

            if (!paymentData || Object.keys(paymentData).length === 0) {
                await ctx.answerCbQuery("Payment not found");
                return;
            }

            const statusMessage = telegramTemplates.paymentStatus({
                paymentId,
                amountUSDT: paymentData.amountUSDT,
                amountVND: paymentData.amountVND,
                status: paymentData.status,
                createdAt: paymentData.createdAt,
                expiresAt: paymentData.expiresAt,
            });

            await ctx.editMessageText(statusMessage, {
                parse_mode: "Markdown",
                reply_markup: telegramKeyboards.paymentStatus({ paymentId }),
            });

            await ctx.answerCbQuery("Payment status loaded");
        } catch (error) {
            console.error("Error fetching payment status:", error);
            try {
                await ctx.answerCbQuery("Error fetching payment status");
            } catch (e) {
                // Ignore additional errors in error handling
            }
        }
    });

    // Cancel payment button
    bot.action(/^cancel_payment_(.+)$/, async (ctx) => {
        try {
            if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) {
                return;
            }

            const match = ctx.callbackQuery.data.match(/^cancel_payment_(.+)$/);
            if (!match) return;

            const paymentId = match[1];
            const userId = ctx.from?.id.toString();

            if (!userId) {
                await ctx.answerCbQuery("User ID not found");
                return;
            }

            const paymentData = await redis.hgetall(`payment:${paymentId}`);

            // Check if payment exists and belongs to this user
            if (!paymentData || paymentData.userId !== userId) {
                await ctx.answerCbQuery("Payment not found or not authorized");
                return;
            }

            // Only pending payments can be canceled
            if (paymentData.status !== "pending") {
                await ctx.answerCbQuery(
                    `Payment cannot be canceled (status: ${paymentData.status})`
                );
                return;
            }

            // Cancel the payment
            await redis.hset(`payment:${paymentId}`, {
                status: "canceled",
                canceledAt: Date.now().toString(),
            });

            // Remove from pending set
            await redis.srem("payments:pending", paymentId);

            // Clear user's active payment if this was it
            const activePaymentId = await redis.get(`user:${userId}:activePayment`);
            if (activePaymentId === paymentId) {
                await redis.del(`user:${userId}:activePayment`);
            }

            await ctx.answerCbQuery("Payment canceled successfully");
            await ctx.editMessageCaption("✅ Payment canceled successfully", {
                reply_markup: telegramKeyboards.mainMenu(),
            });
        } catch (error) {
            console.error("Error canceling payment:", error);
            try {
                await ctx.answerCbQuery("Error canceling payment");
            } catch (e) {
                // Ignore additional errors in error handling
            }
        }
    });
}

/**
 * Set up job to handle expired payments
 */
function setupExpiryJob(
    bot: Telegraf<Scenes.SceneContext>,
    redis: Redis,
    redisHelper: RedisHelper
) {
    // Run every hour
    cron.schedule("0 * * * *", async () => {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] Running expired payments cleanup job`);

        try {
            const now = Date.now();

            // Get all expired payments
            const expiredPayments = await redisHelper.getExpiredPayments();

            if (expiredPayments.length === 0) {
                console.log(`[${timestamp}] No expired payments found`);
                return;
            }

            console.log(`[${timestamp}] Found ${expiredPayments.length} expired payments`);

            for (const paymentId of expiredPayments) {
                try {
                    const paymentData = await redisHelper.getPayment(paymentId);

                    if (!paymentData) {
                        console.log(
                            `[${timestamp}] Payment ${paymentId} not found, removing from expiry set`
                        );
                        await redisHelper.removeFromExpirySet(paymentId);
                        continue;
                    }

                    if (paymentData.status === "pending") {
                        // Mark payment as expired
                        await redisHelper.updatePaymentStatus(paymentId, "expired");

                        // Remove from pending set if it's there
                        await redis.srem("payments:pending", paymentId);

                        // Notify user if possible
                        if (paymentData.userId) {
                            try {
                                await bot.telegram.sendMessage(
                                    paymentData.userId,
                                    telegramTemplates.paymentExpired({
                                        paymentId,
                                        amountUSDT: paymentData.amountUSDT,
                                    }),
                                    {
                                        parse_mode: "Markdown",
                                        reply_markup: telegramKeyboards.paymentConfirmation(),
                                    }
                                );
                                console.log(
                                    `[${timestamp}] Notified user ${paymentData.userId} about expired payment ${paymentId}`
                                );
                            } catch (notifyError) {
                                console.error(
                                    `Failed to notify user about expired payment: ${paymentId}`,
                                    notifyError
                                );
                            }
                        }

                        console.log(`[${timestamp}] Payment ${paymentId} marked as expired`);
                    } else {
                        console.log(
                            `[${timestamp}] Payment ${paymentId} is in state ${paymentData.status}, not marking as expired`
                        );
                    }

                    // Always remove from expiry set regardless of the current state
                    await redisHelper.removeFromExpirySet(paymentId);
                } catch (paymentError) {
                    console.error(`Error processing expired payment ${paymentId}:`, paymentError);
                }
            }

            console.log(`[${timestamp}] Expired payments cleanup job completed`);
        } catch (error: any) {
            console.error("Error in expired payments cleanup job:", error);

            // Notify admin of error
            if (Config.adminChatId) {
                try {
                    await bot.telegram.sendMessage(
                        Config.adminChatId,
                        `⚠️ Error in payment expiry job: ${error.message}`
                    );
                } catch (notifyError) {
                    console.error("Failed to notify admin about expiry job error:", notifyError);
                }
            }
        }
    });

    console.log("Payment expiry job scheduled");
}
