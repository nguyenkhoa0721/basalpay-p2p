/**
 * Telegram bot configuration
 */

import { config } from "dotenv";
config();

export const botConfig = {
    // Bot configuration
    botName: process.env.BOT_NAME || "MBBank P2P Bot",

    // Telegram configuration
    telegram: {
        token: process.env.TELEGRAM_BOT_TOKEN || "",
    },

    // Redis configuration
    redis: {
        url: process.env.REDIS_URL || "redis://localhost:6379",
    },

    // Bank configuration
    bank: {
        name: process.env.BANK_NAME || "MB Bank",
        accountNumber: process.env.BANK_ACCOUNT_NUMBER || "",
        accountName: process.env.BANK_ACCOUNT_NAME || "",
    },

    // Payment configuration
    payment: {
        expiryMinutes: parseInt(process.env.PAYMENT_EXPIRY_MINUTES || "30"),
        markup: parseFloat(process.env.PAYMENT_MARKUP || "2"), // Markup percentage over Binance P2P rate
    },

    // Transaction check configuration
    transactionCheck: {
        intervalMs: parseInt(process.env.TX_CHECK_INTERVAL_MS || "15000"), // Default: 15 seconds
    },

    // Support configuration
    supportUsername: process.env.SUPPORT_USERNAME || "support",

    // Admin configuration
    adminChatId: process.env.ADMIN_CHAT_ID || "",
};
