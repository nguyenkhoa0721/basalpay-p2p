import Redis from "ioredis";
import { Scenes } from "telegraf";
import { callbackQuery, message } from "telegraf/filters";
import { v4 as uuidv4 } from "uuid";

import { Config } from "../config";
import { getBinanceP2PRate } from "../services/binance-service";
import { BasalPayService } from "../services/basal-pay.service";
import {
    telegramKeyboards,
    telegramTemplates,
    formatVND,
} from "../utils/messages/telegram-templates";

// Initialize Redis
const redis = new Redis(Config.redis.url);

// Define flow steps
enum FlowStep {
    ENTER_AMOUNT = "enter_amount",
    COLLECT_EMAIL = "collect_email",
    GENERATE_PAYMENT = "generate_payment",
}

// P2P Payment Scene
export const p2pPaymentScene = new Scenes.BaseScene<Scenes.SceneContext>("p2p-payment");

// Entry point - start the payment process
p2pPaymentScene.enter(async (ctx) => {
    try {
        // Get current USDT balance first
        const basalPayService = new BasalPayService();
        let usdtBalance = "Unknown";
        let hasError = false;
        let numericBalance = 0;

        try {
            usdtBalance = await basalPayService.getUsdtBalance();
            numericBalance = parseFloat(usdtBalance);
            console.log(`Current USDT balance: ${usdtBalance}`);
        } catch (error) {
            console.error("Error fetching USDT balance:", error);
            hasError = true;
        }

        // Display balance first
        const balanceMessage = hasError
            ? "⚠️ Unable to fetch current USDT balance. Please check with support if you encounter issues."
            : `💰 Current USDT balance: *${usdtBalance}* USDT`;

        // If balance is too low, don't even show payment options
        if (!hasError && numericBalance < 1) {
            await ctx.reply(
                "⛔ Insufficient USDT balance. The minimum required balance is 1 USDT.\n\n" +
                    "Please contact support to add funds to your account."
            );
            await ctx.scene.leave();
            return;
        }

        // Then display amount selection message
        const message = "Select an amount or enter your own amount:";

        // Edit existing message or send new one
        if (ctx.callbackQuery) {
            await ctx.editMessageText(message, {
                reply_markup: telegramKeyboards.amountSelection(),
            });
        } else {
            await ctx.reply(balanceMessage + "\n" + message, {
                reply_markup: telegramKeyboards.amountSelection(),
            });
        }

        // Reset user's flow data
        const userId = ctx.from?.id.toString();
        if (userId) {
            await redis.del(`user:${userId}:currentFlow`);
        }
    } catch (error) {
        console.error("Error starting p2p payment:", error);
        await ctx.reply(
            "Sorry, there was an error starting the payment process. Please try again later."
        );
        await ctx.scene.leave();
    }
});

// Handle preset amount selection
p2pPaymentScene.action(/^amount_(\d+)$/, async (ctx) => {
    try {
        if (!ctx.has(callbackQuery("data"))) return;

        const match = ctx.callbackQuery.data.match(/^amount_(\d+)$/);
        if (!match) return;

        const amount = parseInt(match[1]);
        const userId = ctx.from.id.toString();

        // Store the amount and move to email collection
        await redis.hset(`user:${userId}:currentFlow`, {
            step: FlowStep.COLLECT_EMAIL,
            amountUSDT: amount.toString(),
        });

        await ctx.answerCbQuery();
        await ctx.reply(`You selected ${amount} USDT. Please enter your email address:`);
    } catch (error) {
        console.error("Error processing amount selection:", error);
        await ctx.reply("Sorry, there was an error processing your selection. Please try again.");
    }
});

// Handle custom amount button click
p2pPaymentScene.action("custom_amount", async (ctx) => {
    try {
        const userId = ctx.from.id.toString();

        // Update flow to prompt for amount
        await redis.hset(`user:${userId}:currentFlow`, {
            step: FlowStep.ENTER_AMOUNT,
        });

        await ctx.answerCbQuery();
        await ctx.reply("Please enter the amount in USDT (minimum 1 USDT):");
    } catch (error) {
        console.error("Error processing custom amount request:", error);
        await ctx.reply("Sorry, there was an error. Please try again.");
    }
});

// Back button - return to main menu
p2pPaymentScene.action("back", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply("Main menu", {
        reply_markup: telegramKeyboards.mainMenu(),
    });
    await ctx.scene.leave();
});

// Handle show payment details button
p2pPaymentScene.action(/^show_payment_(.+)$/, async (ctx) => {
    if (!ctx.has(callbackQuery("data"))) return;

    const match = ctx.callbackQuery.data.match(/^show_payment_(.+)$/);
    if (!match) return;

    const paymentId = match[1];
    const paymentData = await redis.hgetall(`payment:${paymentId}`);

    if (!paymentData || Object.keys(paymentData).length === 0) {
        await ctx.answerCbQuery("Payment not found");
        return;
    }

    // Show payment details
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
});

// Handle text messages (for amount and email input)
p2pPaymentScene.on(message("text"), async (ctx) => {
    try {
        const userId = ctx.from.id.toString();
        const flowData = await redis.hgetall(`user:${userId}:currentFlow`);

        // If no flow data, restart the flow
        if (!flowData || Object.keys(flowData).length === 0) {
            await ctx.reply("Let's start again. Select an amount or enter your own amount:", {
                reply_markup: telegramKeyboards.amountSelection(),
            });
            return;
        }

        const text = ctx.message.text;
        const step = flowData.step;

        // Handle different steps in the flow
        switch (step) {
            case FlowStep.ENTER_AMOUNT:
                return handleAmountInput(ctx, userId, text);

            case FlowStep.COLLECT_EMAIL:
                return handleEmailInput(ctx, userId, text);

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

/**
 * Handle user's custom amount input
 */
async function handleAmountInput(ctx: any, userId: string, text: string): Promise<void> {
    // Parse the amount (allow decimal values)
    const amount = parseFloat(text.replace(",", "."));

    if (isNaN(amount) || amount < 1) {
        await ctx.reply("Please enter a valid amount (minimum 1 USDT):");
        return;
    }

    // Store the amount and proceed to email collection
    await redis.hset(`user:${userId}:currentFlow`, {
        step: FlowStep.COLLECT_EMAIL,
        amountUSDT: amount.toString(),
    });

    await ctx.reply(`You entered ${amount} USDT. Please enter your email address:`);
}

/**
 * Handle user's email input
 */
async function handleEmailInput(ctx: any, userId: string, text: string): Promise<void> {
    // More comprehensive email validation regex
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

    if (!emailRegex.test(text)) {
        await ctx.reply("Please enter a valid email address (e.g., user@example.com):");
        return;
    }

    // Check if the user exists in BasalPay system
    try {
        const basalPayService = new BasalPayService();
        const basalPayUserId = await basalPayService.getUserByEmail(text);

        if (!basalPayUserId) {
            await ctx.reply(
                "This email is not registered with BasalPay. Please enter an email address associated with a BasalPay account:"
            );
            return;
        }

        await redis.hset(`user:${userId}:currentFlow`, {
            email: text,
            basalPayUserId,
            step: FlowStep.GENERATE_PAYMENT,
        });

        await generatePaymentInfo(ctx, userId);
    } catch (error) {
        console.error("Error validating email with BasalPay:", error);
        await ctx.reply("There was an error validating your email. Please try again later.");
    }
}

/**
 * Generate payment info and send it to the user
 */
async function generatePaymentInfo(ctx: any, userId: string): Promise<void> {
    try {
        const flowData = await redis.hgetall(`user:${userId}:currentFlow`);

        if (!flowData?.amountUSDT || !flowData?.email) {
            throw new Error("Missing required payment data");
        }

        // Verify available USDT balance
        const basalPayService = new BasalPayService();
        const hasSufficientBalance = await basalPayService.hasSufficientBalance(
            flowData.amountUSDT
        );

        if (!hasSufficientBalance) {
            await ctx.reply(
                `⚠️ Insufficient USDT balance to process ${flowData.amountUSDT} USDT. Please try a smaller amount.`
            );
            await ctx.scene.leave();
            return;
        }

        // Get exchange rate
        const binanceRate = await getBinanceP2PRate();
        if (!binanceRate) {
            throw new Error("Could not fetch exchange rate");
        }

        // Apply markup
        const rate = binanceRate * (1 + Config.payment.markup / 100);

        // Calculate VND amount
        const amountUSDT = parseFloat(flowData.amountUSDT);
        const amountVND = Math.ceil(amountUSDT * rate);

        // Generate payment ID and memo
        const paymentId = uuidv4();
        const numericPart = parseInt(paymentId.replace(/-/g, "").substring(0, 8), 16);
        const memo = (numericPart % 100000000).toString().padStart(8, "0");

        // Set payment expiry time
        const now = Date.now();
        const expiryMinutes = Config.payment.expiryMinutes;
        const expiresAt = now + expiryMinutes * 60 * 1000;

        // Store payment details in Redis
        await redis.hset(`payment:${paymentId}`, {
            userId,
            email: flowData.email,
            basalPayUserId: flowData.basalPayUserId,
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

        // Send QR code with payment details
        await ctx.replyWithPhoto(qrUrl, {
            caption: generatePaymentCaption(
                amountUSDT,
                amountVND,
                rate,
                memo,
                paymentId,
                expiryMinutes
            ),
            parse_mode: "Markdown",
            reply_markup: telegramKeyboards.paymentDetails({
                accountNumber: Config.bank.accountNumber,
                memo,
                amountVND,
                paymentId,
            }),
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

/**
 * Generate payment caption with all required details
 */
function generatePaymentCaption(
    amountUSDT: number,
    amountVND: number,
    rate: number,
    memo: string,
    paymentId: string,
    expiryMinutes: number
): string {
    return (
        `💳 *Payment Details*\n\n` +
        `💰 Amount: *${amountUSDT} USDT* (${formatVND(amountVND)} VND)\n` +
        `💹 Rate: ${formatVND(Math.round(rate))} VND/USDT\n\n` +
        `🏦 Bank: \`${Config.bank.name}\`\n` +
        `👤 Name: \`${Config.bank.accountName}\`\n` +
        `🔢 Account: \`${Config.bank.accountNumber}\`\n` +
        `📝 Memo: \`${memo}\`\n\n` +
        `⚠️ *IMPORTANT:* Transfer with the exact memo code\n\n` +
        `🆔 Payment ID: ${paymentId.substring(0, 8)}\n` +
        `⏱ Expires in ${expiryMinutes} minutes`
    );
}
