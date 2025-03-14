import { config } from "dotenv";

// Load environment variables
config();

export const Config = {
    // Basal Pay configuration
    basalPay: {
        apiUrl: process.env.BASAL_PAY_API_URL || "https://sandbox-api.basalpay.com/api/v1",
        accessToken: process.env.BASAL_PAY_ACCESS_TOKEN || "",
        fundPassword: process.env.BASAL_PAY_FUND_PASSWORD || "",
    },

    // Bot configuration
    botName: process.env.BOT_NAME || "MBBank P2P Bot",
    telegram: {
        token: process.env.TELEGRAM_BOT_TOKEN || "",
    },

    // Redis configuration
    redis: {
        url: process.env.REDIS_URL || "redis://localhost:6379",
    },

    // Bank configuration
    bank: {
        username: process.env.BANK_USERNAME || "",
        password: process.env.BANK_PASSWORD || "",
        name: process.env.BANK_NAME || "MB Bank",
        accountNumber: process.env.BANK_ACCOUNT_NUMBER || "",
        accountName: process.env.BANK_ACCOUNT_NAME || "",
    },

    // Payment configuration
    payment: {
        expiryMinutes: parseInt(process.env.PAYMENT_EXPIRY_MINUTES || "30"),
        markup: parseFloat(process.env.PAYMENT_MARKUP || "0"),
    },

    // Transaction monitoring configuration
    transactionCheck: {
        intervalMs: parseInt(process.env.TX_CHECK_INTERVAL_MS || "15000"),
    },

    // Support configuration
    supportUsername: process.env.SUPPORT_USERNAME || "support",
    adminChatId: process.env.ADMIN_CHAT_ID || "",
};
