import { config } from "dotenv";
import Redis from "ioredis";
import { BankService } from "./services/bank.service";
import { initBot } from "./bot";
import { Config } from "./config";
import { RedisHelper } from "./utils/redis-helper";

// Load environment variables
config();

// Start the application
async function start() {
    try {
        console.log("Starting MBBank P2P application...");

        // Initialize Redis
        const redis = new Redis(Config.redis.url);
        console.log("Connected to Redis");

        // Initialize Redis helper
        const redisHelper = new RedisHelper(redis);

        // Initialize bank service
        const bankService = new BankService();
        console.log("Bank service initialized");

        // Initialize and start the bot
        await initBot(bankService, redis, redisHelper);
    } catch (error) {
        console.error("Failed to start application:", error);
        process.exit(1);
    }
}

start();
