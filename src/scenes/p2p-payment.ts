import Redis from "ioredis";
import { Scenes } from "telegraf";
import { callbackQuery, message } from "telegraf/filters";
import { v4 as uuidv4 } from "uuid";

import { Config } from "../config";
import { getBinanceP2PRate } from "../services/binance-service";
import { telegramKeyboards, telegramTemplates } from "../utils/messages/telegram-templates";

// Initialize Redis
const redis = new Redis(Config.redis.url);

/**
 * Format a number as VND currency
 */
function formatVND(amount: number): string {
    return amount.toLocaleString("vi-VN");
}

// P2P Payment Scene
export const p2pPaymentScene = new Scenes.BaseScene<Scenes.SceneContext>("p2p-payment");

// Entry point
p2pPaymentScene.enter(async (ctx) => {
    try {
        // Edit the current message if possible (after clicking P2P payment button)
        if (ctx.callbackQuery) {
            await ctx.editMessageText("Select an amount or enter your own amount:", {
                reply_markup: telegramKeyboards.amountSelection(),
            });
        } else {
            // Otherwise send a new message
            await ctx.reply("Select an amount or enter your own amount:", {
                reply_markup: telegramKeyboards.amountSelection(),
            });
        }

        // Reset any previously stored data for the flow
        const userId = ctx.from?.id.toString();
        if (userId) {
            await redis.del(`user:${userId}:currentFlow`);
        }
    } catch (error) {
        console.error("Error in p2p-payment scene enter:", error);
        await ctx.reply(
            "Sorry, there was an error starting the payment process. Please try again later."
        );
        await ctx.scene.leave();
    }
});

// Handle amount selection with callback queries
p2pPaymentScene.action(/^amount_(\d+)$/, async (ctx) => {
    try {
        const userId = ctx.from.id.toString();
        if (!ctx.has(callbackQuery("data"))) {
            return;
        }

        const match = ctx.callbackQuery.data.match(/^amount_(\d+)$/);
        if (!match) {
            return;
        }
        const amount = parseInt(match[1]);

        // Store the amount in Redis
        await redis.hset(`user:${userId}:currentFlow`, {
            step: "collect_email",
            amountUSDT: amount.toString(),
        });

        await ctx.answerCbQuery();
        await ctx.reply(`You selected ${amount} USDT. Please enter your email address:`);
    } catch (error) {
        console.error("Error processing amount selection:", error);
        await ctx.reply("Sorry, there was an error processing your selection. Please try again.");
    }
});

// Handle custom amount callback
p2pPaymentScene.action("custom_amount", async (ctx) => {
    try {
        const userId = ctx.from.id.toString();

        // Update flow state
        await redis.hset(`user:${userId}:currentFlow`, {
            step: "enter_amount",
        });

        await ctx.answerCbQuery();
        await ctx.reply("Please enter the amount in USDT (minimum 1 USDT):");
    } catch (error) {
        console.error("Error processing custom amount request:", error);
        await ctx.reply("Sorry, there was an error. Please try again.");
    }
});

// Back button callback
p2pPaymentScene.action("back", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply("Main menu", {
        reply_markup: {
            inline_keyboard: [
                [{ text: "💰 P2P Payment", callback_data: "p2p_payment" }],
                [{ text: "📞 Support", callback_data: "support" }],
            ],
        },
    });
    await ctx.scene.leave();
});

// Handle copy buttons
p2pPaymentScene.action(/^copy_account_(.+)$/, async (ctx) => {
    if (ctx.has(callbackQuery("data"))) {
        const match = ctx.callbackQuery.data.match(/^copy_account_(.+)$/);
        if (match) {
            const accountNumber = match[1];
            await ctx.answerCbQuery(`Account number ${accountNumber} copied to clipboard`);
        }
    }
});

p2pPaymentScene.action(/^copy_memo_(.+)$/, async (ctx) => {
    if (ctx.has(callbackQuery("data"))) {
        const match = ctx.callbackQuery.data.match(/^copy_memo_(.+)$/);
        if (match) {
            const memo = match[1];
            await ctx.answerCbQuery(`Memo ${memo} copied to clipboard`);
        }
    }
});

p2pPaymentScene.action(/^copy_amount_(.+)$/, async (ctx) => {
    if (ctx.has(callbackQuery("data"))) {
        const match = ctx.callbackQuery.data.match(/^copy_amount_(.+)$/);
        if (match) {
            const amount = match[1];
            await ctx.answerCbQuery(
                `Amount ${formatVND(parseInt(amount))} VND copied to clipboard`
            );
        }
    }
});

p2pPaymentScene.action(/^check_status_(.+)$/, async (ctx) => {
    if (ctx.has(callbackQuery("data"))) {
        const match = ctx.callbackQuery.data.match(/^check_status_(.+)$/);
        if (match) {
            const paymentId = match[1];
            const paymentData = await redis.hgetall(`payment:${paymentId}`);

            if (!paymentData || Object.keys(paymentData).length === 0) {
                await ctx.answerCbQuery("Payment not found");
                return;
            }

            const statusMessage = `📝 Payment #${paymentId.substring(0, 8)}
            
Amount: ${paymentData.amountUSDT} USDT (${formatVND(parseInt(paymentData.amountVND))} VND)
Status: ${paymentData.status}
Created: ${new Date(parseInt(paymentData.createdAt)).toLocaleString()}
${
    paymentData.status === "pending"
        ? `Expires: ${new Date(parseInt(paymentData.expiresAt)).toLocaleString()}`
        : ""
}`;

            // Edit the original message to show status instead of creating a new one
            await ctx.editMessageText(statusMessage, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "💰 P2P Payment", callback_data: "p2p_payment" }],
                        [{ text: "📞 Support", callback_data: "support" }],
                        [
                            {
                                text: "↩️ Back to Payment",
                                callback_data: `show_payment_${paymentId}`,
                            },
                        ],
                    ],
                },
            });
            await ctx.answerCbQuery("Payment status updated");
        }
    }
});

p2pPaymentScene.action(/^show_payment_(.+)$/, async (ctx) => {
    if (ctx.has(callbackQuery("data"))) {
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
            const expiryMinutes = Config.payment.expiryMinutes;

            // Create payment instructions message with clickable copy buttons
            const instructionMessage = telegramTemplates.paymentDetails({
                amountUSDT,
                amountVND,
                rate,
                memo,
                paymentId,
                expiryMinutes,
                status: "pending",
            });

            // Edit the original message to show payment details again
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

// Handle custom amount input
p2pPaymentScene.on(message("text"), async (ctx) => {
    try {
        const userId = ctx.from.id.toString();
        const flowData = await redis.hgetall(`user:${userId}:currentFlow`);

        // If no flow data, start over
        if (!flowData || Object.keys(flowData).length === 0) {
            await ctx.reply("Let's start again. Select an amount or enter your own amount:", {
                reply_markup: telegramKeyboards.amountSelection(),
            });
            return;
        }

        const text = ctx.message.text;

        // Handle different steps in the flow
        switch (flowData.step) {
            case "enter_amount":
                // Parse the amount (allow decimal values)
                const amount = parseFloat(text.replace(",", "."));

                if (isNaN(amount) || amount < 1) {
                    await ctx.reply("Please enter a valid amount (minimum 1 USDT):");
                    return;
                }

                // Store the amount and proceed to email collection
                await redis.hset(`user:${userId}:currentFlow`, {
                    step: "collect_email",
                    amountUSDT: amount.toString(),
                });

                await ctx.reply(`You entered ${amount} USDT. Please enter your email address:`);
                break;

            case "collect_email":
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(text)) {
                    await ctx.reply("Please enter a valid email address:");
                    return;
                }

                await redis.hset(`user:${userId}:currentFlow`, {
                    email: text,
                    step: "generate_payment",
                });

                await generatePaymentInfo(ctx, userId);
                break;

            default:
                await ctx.reply("Something went wrong. Let's start again.", {
                    reply_markup: telegramKeyboards.amountSelection(),
                });
        }
    } catch (error) {
        console.error("Error in p2p-payment text handler:", error);
        await ctx.reply("Sorry, there was an error processing your input. Please try again.");
    }
});

async function generatePaymentInfo(ctx: any, userId: string) {
    try {
        const flowData = await redis.hgetall(`user:${userId}:currentFlow`);

        if (!flowData || !flowData.amountUSDT || !flowData.email) {
            throw new Error("Missing required payment data");
        }

        const binanceRate = await getBinanceP2PRate();

        if (!binanceRate) {
            throw new Error("Could not fetch exchange rate");
        }

        // Apply markup (rate + configured markup percentage)
        const rate = binanceRate * (1 + Config.payment.markup / 100);

        // Calculate VND amount - always as integer
        const amountUSDT = parseFloat(flowData.amountUSDT);
        const amountVND = Math.ceil(amountUSDT * rate);

        // Generate payment ID and memo (only numbers)
        const paymentId = uuidv4();
        // Generate a numeric memo by taking the hexadecimal UUID and converting parts to numbers
        // This will create an 8-digit numeric memo
        const numericPart = parseInt(paymentId.replace(/-/g, "").substring(0, 8), 16);
        const memo = (numericPart % 100000000).toString().padStart(8, "0");

        const now = Date.now();
        const expiryMinutes = Config.payment.expiryMinutes;
        const expiresAt = now + expiryMinutes * 60 * 1000;

        await redis.hset(`payment:${paymentId}`, {
            userId,
            email: flowData.email,
            recipientUserId: flowData.recipientUserId || "", // Store Basal Pay User ID
            amountUSDT: amountUSDT.toString(),
            amountVND: amountVND.toString(),
            rate: rate.toString(),
            memo,
            status: "pending",
            createdAt: now.toString(),
            expiresAt: expiresAt.toString(),
        });

        // Add to expiry set for cleanup
        await redis.zadd("payments:expiry", expiresAt, paymentId);

        // Add to pending payments set
        await redis.sadd("payments:pending", paymentId);

        // Set as user's active payment
        await redis.set(`user:${userId}:activePayment`, paymentId);

        // Generate VietQR URL
        const qrUrl = `https://qr.sepay.vn/img?acc=${Config.bank.accountNumber}&bank=MB&amount=${amountVND}&des=${memo}`;

        // Create a caption for the QR code with formatted text and emoji key-value pairs
        const caption =
            `💳 *Payment Details*\n\n` +
            `💰 Amount: *${amountUSDT} USDT* (${formatVND(amountVND)} VND)\n` +
            `💹 Rate: ${formatVND(Math.round(rate))} VND/USDT\n\n` +
            `🏦 Bank: \`${Config.bank.name}\`\n` +
            `👤 Name: \`${Config.bank.accountName}\`\n` +
            `🔢 Account: \`${Config.bank.accountNumber}\`\n` +
            `📝 Memo: \`${memo}\`\n\n` +
            `⚠️ *IMPORTANT:* Transfer with the exact memo code\n\n` +
            `🆔 Payment ID: ${paymentId.substring(0, 8)}\n` +
            `⏱ Expires in ${expiryMinutes} minutes`;

        // Send QR code as photo with caption
        await ctx.replyWithPhoto(qrUrl, {
            caption: caption,
            parse_mode: "Markdown",
            reply_markup: {
                inline_keyboard: [[{ text: "📞 Support", callback_data: "support" }]],
            },
        });

        console.log(
            `Payment created: ${paymentId} for user ${userId} - ${amountUSDT} USDT (${amountVND} VND)`
        );

        // Exit the scene
        await ctx.scene.leave();
    } catch (error) {
        console.error("Error generating payment info:", error);
        await ctx.reply(
            "Sorry, there was an error generating payment information. Please try again later."
        );
        await ctx.scene.leave();
    }
}
