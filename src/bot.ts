import { Telegraf, Scenes, session } from "telegraf";
import { message } from "telegraf/filters";
import Redis from "ioredis";
import { v4 as uuidv4 } from "uuid";
import cron from "node-cron";

import { p2pPaymentScene } from "./scenes/p2p-payment";
import { setupTransactionMonitor } from "./services/transaction-monitor";
import { Config } from "./config";
import { BankService } from "./services/bank.service";
import { telegramTemplates, telegramKeyboards } from "./utils/messages/telegram-templates";

const redis = new Redis(Config.redis.url);

const bot = new Telegraf<Scenes.SceneContext>(Config.telegram.token);

export async function initBot(bankService: BankService) {
    try {
        const stage = new Scenes.Stage<Scenes.SceneContext>([p2pPaymentScene]);
        bot.use(session());
        bot.use(stage.middleware());

        bot.start(async (ctx) => {
            try {
                const welcomeMessage = telegramTemplates.welcome();

                await ctx.reply(welcomeMessage, {
                    reply_markup: telegramKeyboards.mainMenu(),
                });

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

        bot.help((ctx) => {
            ctx.reply(telegramTemplates.help());
        });

        bot.action("p2p_payment", (ctx) => {
            ctx.answerCbQuery();
            ctx.scene.enter("p2p-payment");
        });

        bot.action("support", (ctx) => {
            ctx.answerCbQuery();
            ctx.reply(telegramTemplates.support());
        });

        bot.action(/^copy_account_(.+)$/, async (ctx) => {
            if (ctx.callbackQuery && "data" in ctx.callbackQuery) {
                const match = ctx.callbackQuery.data.match(/^copy_account_(.+)$/);
                if (match) {
                    const accountNumber = match[1];
                    await ctx.answerCbQuery(`Account number ${accountNumber} copied to clipboard`);
                }
            }
        });

        bot.action(/^copy_memo_(.+)$/, async (ctx) => {
            if (ctx.callbackQuery && "data" in ctx.callbackQuery) {
                const match = ctx.callbackQuery.data.match(/^copy_memo_(.+)$/);
                if (match) {
                    const memo = match[1];
                    await ctx.answerCbQuery(`Memo ${memo} copied to clipboard`);
                }
            }
        });

        bot.action(/^copy_amount_(.+)$/, async (ctx) => {
            if (ctx.callbackQuery && "data" in ctx.callbackQuery) {
                const match = ctx.callbackQuery.data.match(/^copy_amount_(.+)$/);
                if (match) {
                    const amount = match[1];
                    await ctx.answerCbQuery(
                        `Amount ${parseInt(amount).toLocaleString("vi-VN")} VND copied to clipboard`
                    );
                }
            }
        });

        bot.action(/^show_payment_(.+)$/, async (ctx) => {
            if (ctx.callbackQuery && "data" in ctx.callbackQuery) {
                const match = ctx.callbackQuery.data.match(/^show_payment_(.+)$/);
                if (match) {
                    const paymentId = match[1];
                    const paymentData = await redis.hgetall(`payment:${paymentId}`);

                    if (!paymentData || Object.keys(paymentData).length === 0) {
                        await ctx.answerCbQuery("Payment not found");
                        return;
                    }

                    const amountUSDT = parseFloat(paymentData.amountUSDT);
                    const amountVND = parseInt(paymentData.amountVND);
                    const rate = parseFloat(paymentData.rate);
                    const memo = paymentData.memo;
                    const expiryMinutes = Config.payment.expiryMinutes;

                    const instructionMessage = telegramTemplates.paymentDetails({
                        amountUSDT,
                        amountVND,
                        rate,
                        memo,
                        paymentId,
                        expiryMinutes,
                        status: paymentData.status,
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
                }
            }
        });

        bot.action(/^check_status_(.+)$/, async (ctx) => {
            if (ctx.callbackQuery && "data" in ctx.callbackQuery) {
                const match = ctx.callbackQuery.data.match(/^check_status_(.+)$/);
                if (match) {
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
                    await ctx.answerCbQuery("Payment status updated");
                }
            }
        });

        bot.command("p2p", (ctx) => {
            ctx.scene.enter("p2p-payment");
        });

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

        bot.command("support", (ctx) => {
            ctx.reply(telegramTemplates.support());
        });

        bot.on(message("text"), (ctx) => {
            ctx.reply(
                "Sorry, I didn't understand that. Please use the inline buttons or type /help for assistance.",
                {
                    reply_markup: telegramKeyboards.mainMenu(),
                }
            );
        });

        setupTransactionMonitor(bot, redis, bankService);

        cron.schedule("0 * * * *", async () => {
            try {
                const now = Date.now();
                const expiredPayments = await redis.zrangebyscore("payments:expiry", 0, now);

                for (const paymentId of expiredPayments) {
                    const paymentData = await redis.hgetall(`payment:${paymentId}`);

                    if (paymentData && paymentData.status === "pending") {
                        await redis.hset(`payment:${paymentId}`, "status", "expired");

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
                            } catch (error) {
                                console.error(
                                    `Failed to notify user about expired payment: ${paymentId}`,
                                    error
                                );
                            }
                        }

                        await redis.zrem("payments:expiry", paymentId);

                        console.log(`Payment expired: ${paymentId}`);
                    }
                }
            } catch (error) {
                console.error("Error in expired payments cleanup job:", error);
            }
        });

        bot.catch((err, ctx) => {
            console.error(`Error in bot update ${ctx.update.update_id}:`, err);
            ctx.reply("An error occurred while processing your request. Please try again later.");
        });

        await bot.launch();
        console.log(`Bot started as @${bot.botInfo?.username}`);

        process.once("SIGINT", () => bot.stop("SIGINT"));
        process.once("SIGTERM", () => bot.stop("SIGTERM"));

        return bot;
    } catch (error) {
        console.error("Failed to initialize bot:", error);
        throw error;
    }
}
