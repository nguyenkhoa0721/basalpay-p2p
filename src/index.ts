import { config } from "dotenv";
import { BankService } from "./services/bank.service";
import { initBot } from "./bot";

// Load environment variables from .env file
config();

// Initialize the bank service
const bankService = new BankService({
    username: process.env.BANK_USERNAME || "",
    password: process.env.BANK_PASSWORD || "",
    preferredOCRMethod: "default",
    saveWasm: true,
});

// Start the bot
initBot(bankService).catch((error) => {
    console.error("Failed to start the bot:", error);
});
