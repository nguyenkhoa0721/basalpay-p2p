import { config } from "dotenv";
config();

export const Config = {
    basalPay: {
        apiUrl: process.env.BASAL_PAY_API_URL || "https://sandbox-api.basalpay.com/api/v1",
        accessToken: process.env.BASAL_PAY_ACCESS_TOKEN || "",
        fundPassword: process.env.BASAL_PAY_FUND_PASSWORD || "",
    },
    botName: process.env.BOT_NAME || "MBBank P2P Bot",
    telegram: {
        token: process.env.TELEGRAM_BOT_TOKEN || "",
    },
    redis: {
        url: process.env.REDIS_URL || "redis://localhost:6379",
    },
    bank: {
        username: process.env.BANK_USERNAME || "",
        password: process.env.BANK_PASSWORD || "",
        name: process.env.BANK_NAME || "MB Bank",
        accountNumber: process.env.BANK_ACCOUNT_NUMBER || "",
        accountName: process.env.BANK_ACCOUNT_NAME || "",
    },
    payment: {
        expiryMinutes: parseInt(process.env.PAYMENT_EXPIRY_MINUTES || "30"),
        markup: parseFloat(process.env.PAYMENT_MARKUP || "0"),
    },
    transactionCheck: {
        intervalMs: parseInt(process.env.TX_CHECK_INTERVAL_MS || "15000"),
    },
    supportUsername: process.env.SUPPORT_USERNAME || "support",
    adminChatId: process.env.ADMIN_CHAT_ID || "",
};
