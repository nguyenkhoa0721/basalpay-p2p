import { config } from "dotenv";
import { BankService } from "./services/bank.service";
import { BasalPayService } from "./services/basal-pay.service";
import { initBot } from "./bot";

// Load environment variables from .env file
config();

// Initialize the bank service
const bankService = new BankService();

// Start the bot
initBot(bankService).catch((error) => {
    console.error("Failed to start the bot:", error);
});
