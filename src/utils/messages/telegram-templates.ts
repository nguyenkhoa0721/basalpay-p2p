import { Config } from "../../config";

/**
 * Format a number as VND currency
 * @param amount The amount to format
 * @returns Formatted amount with Vietnamese locale
 */
export function formatVND(amount: number): string {
    return amount.toLocaleString("vi-VN");
}

/**
 * Templates for Telegram messages
 */
export const telegramTemplates = {
    /**
     * Generate payment details message
     */
    paymentDetails: (params: {
        amountUSDT: number;
        amountVND: number;
        rate: number;
        memo: string;
        paymentId: string;
        expiryMinutes: number;
        status?: string;
    }) => {
        const { amountUSDT, amountVND, rate, memo, paymentId, expiryMinutes, status } = params;

        return (
            `💳 *Payment Details*\n\n` +
            `📊 *Transaction Information:*\n` +
            `• Amount: ${amountUSDT} USDT\n` +
            `• VND Amount: ${formatVND(amountVND)} VND\n` +
            `• Rate: ${formatVND(rate)} VND/USDT\n\n` +
            `🏦 *Transfer Details:*\n` +
            `\`\`\`\n` +
            `BANK:   ${Config.bank.name}\n` +
            `ACCOUNT: ${Config.bank.accountNumber}\n` +
            `NAME:   ${Config.bank.accountName}\n` +
            `MEMO:   ${memo}\n` +
            `\`\`\`\n\n` +
            `⚠️ IMPORTANT: You MUST include the memo code in your transfer description!\n\n` +
            `Your USDT will be automatically sent to your Basal Pay wallet once payment is confirmed.\n` +
            `(We'll use your email to find your Basal Pay account)\n\n` +
            `Payment ID: ${paymentId.substring(0, 8)}${
                status === "pending"
                    ? `\n⏱ This payment request will expire in ${expiryMinutes} minutes.`
                    : `\nStatus: ${status}`
            }\n\n` +
            `We'll automatically notify you once the payment is confirmed.`
        );
    },

    /**
     * Generate payment status message
     */
    paymentStatus: (params: {
        paymentId: string;
        amountUSDT: number | string;
        amountVND: number | string;
        status: string;
        createdAt: number | string;
        expiresAt?: number | string;
    }) => {
        const { paymentId, amountUSDT, amountVND, status, createdAt, expiresAt } = params;

        // Format status with emoji
        let statusDisplay = "";
        switch (status) {
            case "pending":
                statusDisplay = "⏳ Pending";
                break;
            case "processing":
                statusDisplay = "⚙️ Processing";
                break;
            case "completed":
                statusDisplay = "✅ Completed";
                break;
            case "expired":
                statusDisplay = "⏰ Expired";
                break;
            case "canceled":
                statusDisplay = "❌ Canceled";
                break;
            case "manual_review":
                statusDisplay = "⚠️ Under Review";
                break;
            case "error":
                statusDisplay = "⚠️ Error (Contact Support)";
                break;
            default:
                statusDisplay = status;
        }

        return (
            `📝 *Payment Status*\n\n` +
            `Payment ID: ${paymentId.substring(0, 8)}\n` +
            `Amount: ${amountUSDT} USDT (${
                typeof amountVND === "number"
                    ? formatVND(amountVND)
                    : formatVND(parseInt(amountVND as string))
            } VND)\n` +
            `Status: ${statusDisplay}\n` +
            `Created: ${new Date(
                typeof createdAt === "number" ? createdAt : parseInt(createdAt as string)
            ).toLocaleString()}\n` +
            `${
                status === "pending" && expiresAt
                    ? `Expires: ${new Date(
                          typeof expiresAt === "number" ? expiresAt : parseInt(expiresAt as string)
                      ).toLocaleString()}`
                    : ""
            }\n`
        );
    },

    /**
     * Generate payment confirmation message
     */
    paymentConfirmed: (params: {
        amountUSDT: number | string;
        amountVND: number | string;
        transactionRef: string;
        usdtTransactionId?: string;
    }) => {
        const { amountUSDT, amountVND, transactionRef, usdtTransactionId } = params;

        return (
            `✅ *Payment Confirmed*\n\n` +
            `Your payment of *${amountUSDT} USDT* has been received and confirmed!\n\n` +
            `*Transaction Details:*\n` +
            `• Reference: ${transactionRef}\n` +
            `• Amount: ${
                typeof amountVND === "number"
                    ? formatVND(amountVND)
                    : formatVND(parseInt(amountVND as string))
            } VND\n` +
            `• Status: Completed\n` +
            (usdtTransactionId ? `• USDT Transfer ID: ${usdtTransactionId}\n` : "") +
            `\n` +
            `Your USDT will be automatically sent to your Basal Pay wallet.\n\n` +
            `Thank you for using our service.`
        );
    },

    /**
     * Generate payment expired message
     */
    paymentExpired: (params: { paymentId: string; amountUSDT: number | string }) => {
        const { paymentId, amountUSDT } = params;

        return (
            `⚠️ *Payment Expired*\n\n` +
            `Your payment #${paymentId.substring(0, 8)} for ${amountUSDT} USDT has expired.\n\n` +
            `If you still want to make this payment, please start a new payment transaction.`
        );
    },

    /**
     * Generate admin notification for completed payment
     */
    adminPaymentNotification: (params: {
        paymentId: string;
        amountUSDT: number | string;
        amountVND: number | string;
        userId: string;
        email: string;
        transactionRef: string;
    }) => {
        const { paymentId, amountUSDT, amountVND, userId, email, transactionRef } = params;

        return (
            `💰 Payment confirmed!\n\n` +
            `ID: ${paymentId}\n` +
            `Amount: ${amountUSDT} USDT (${amountVND} VND)\n` +
            `User: ${userId}\n` +
            `Email: ${email}\n` +
            `Transaction: ${transactionRef}`
        );
    },

    /**
     * Generate welcome message with operating hours and USDT balance
     */
    welcome: (usdtBalance?: string) => {
        const balanceInfo = usdtBalance 
            ? `\n\n💰 Available USDT balance: *${usdtBalance}*` 
            : '';
            
        return (
            `👋 Welcome to ${Config.botName}!\n\n` +
            `I can help you make P2P payments quickly and securely.\n\n` +
            `⏰ *Operating Hours:* 9:00 AM - 12:00 AM (midnight) Vietnam time` +
            balanceInfo
        );
    },

    /**
     * Generate help message
     */
    help: () => {
        return (
            `${Config.botName} Help:\n\n` +
            `/start - Start the bot\n` +
            `/p2p - Start a P2P payment\n` +
            `/status - Check your payment status\n` +
            `/support - Contact support\n` +
            `/help - Show this help message\n\n` +
            `⏰ *Operating Hours:* 9:00 AM - 12:00 AM (midnight) Vietnam time`
        );
    },

    /**
     * Generate support message
     */
    support: () => {
        return `For support, please contact @${Config.supportUsername}`;
    },
};

/**
 * Keyboard buttons for Telegram messages
 */
export const telegramKeyboards = {
    /**
     * Amount selection for USDT transfer
     */
    usdtAmountSelection: (balance: number) => {
        // Calculate how much of balance to show in buttons (25%, 50%, 75%)
        const quarter = Math.floor(balance * 0.25 * 100) / 100;
        const half = Math.floor(balance * 0.5 * 100) / 100;
        const threeQuarters = Math.floor(balance * 0.75 * 100) / 100;

        return {
            inline_keyboard: [
                [
                    { text: `${quarter} USDT`, callback_data: `usdt_amount_${quarter}` },
                    { text: `${half} USDT`, callback_data: `usdt_amount_${half}` },
                ],
                [
                    {
                        text: `${threeQuarters} USDT`,
                        callback_data: `usdt_amount_${threeQuarters}`,
                    },
                    { text: `MAX (${balance} USDT)`, callback_data: `usdt_amount_${balance}` },
                ],
                [{ text: "Custom Amount", callback_data: "custom_usdt_amount" }],
                [{ text: "🔙 Back", callback_data: "back" }],
            ],
        };
    },

    /**
     * USDT transfer confirmation keyboard
     */
    usdtConfirmation: () => {
        return {
            inline_keyboard: [
                [
                    { text: "✅ Confirm Purchase", callback_data: "confirm_transfer" },
                    { text: "❌ Cancel", callback_data: "cancel_transfer" },
                ],
            ],
        };
    },

    /**
     * Transfer completed keyboard
     */
    transferDone: () => {
        return {
            inline_keyboard: [
                [{ text: "🏠 Return to Main Menu", callback_data: "back" }],
                [{ text: "📞 Support", callback_data: "support" }],
            ],
        };
    },
    /**
     * Main menu keyboard
     */
    mainMenu: () => {
        return {
            inline_keyboard: [
                [{ text: "💰 P2P Payment", callback_data: "p2p_payment" }],
                [{ text: "📞 Support", callback_data: "support" }],
            ],
        };
    },

    /**
     * Payment support keyboard - only support button
     */
    paymentSupport: () => {
        return {
            inline_keyboard: [[{ text: "📞 Support", callback_data: "support" }]],
        };
    },

    /**
     * Payment details keyboard
     */
    paymentDetails: (params: {
        accountNumber: string;
        memo: string;
        amountVND: number | string;
        paymentId: string;
    }) => {
        const { accountNumber, memo, amountVND, paymentId } = params;

        return {
            inline_keyboard: [
                [{ text: "❌ Cancel Payment", callback_data: `cancel_payment_${paymentId}` }],
                [
                    { text: "💰 New Payment", callback_data: "p2p_payment" },
                    { text: "📞 Support", callback_data: "support" },
                ],
            ],
        };
    },

    /**
     * Payment status keyboard
     */
    paymentStatus: (params: { paymentId: string }) => {
        const { paymentId } = params;

        return {
            inline_keyboard: [
                [{ text: "↩️ Back to Payment", callback_data: `show_payment_${paymentId}` }],
                [{ text: "💰 New Payment", callback_data: "p2p_payment" }],
                [{ text: "📞 Support", callback_data: "support" }],
            ],
        };
    },

    /**
     * Payment amount selection keyboard
     */
    amountSelection: () => {
        return {
            inline_keyboard: [
                [
                    { text: "10 USDT", callback_data: "amount_10" },
                    { text: "50 USDT", callback_data: "amount_50" },
                    { text: "100 USDT", callback_data: "amount_100" },
                ],
                [{ text: "Custom Amount", callback_data: "custom_amount" }],
                [{ text: "🔙 Back", callback_data: "back" }],
            ],
        };
    },

    /**
     * Payment confirmation keyboard
     */
    paymentConfirmation: () => {
        return {
            inline_keyboard: [
                [{ text: "💰 New Payment", callback_data: "p2p_payment" }],
                [{ text: "📞 Support", callback_data: "support" }],
            ],
        };
    },
};
