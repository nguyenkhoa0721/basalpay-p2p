# MBBank P2P Telegram Bot Docker Deployment

This document provides instructions for deploying the MBBank P2P Telegram Bot using Docker.

## Prerequisites

- Docker installed on your server
- Docker Compose installed on your server
- Environment variables configured (see `.env.sample`)

## Quick Start

1. **Prepare your environment file**

   Copy the sample environment file and fill in your configuration details:
   ```bash
   cp .env.sample .env
   # Edit .env with your editor
   ```

2. **Deploy with Docker Compose**

   Build and start the container:
   ```bash
   docker-compose up -d
   ```

3. **Check the logs**

   To verify the application is running correctly:
   ```bash
   docker-compose logs -f
   ```

## Deployment on ARM64 Architecture (e.g., Apple M1/M2)

If you're deploying on ARM64 architecture (like Apple Silicon M1/M2 machines), use the ARM64-specific files:

```bash
docker-compose -f docker-compose.arm64.yml up -d
```

The ARM64 configuration uses a Debian-based image instead of Alpine to ensure compatibility with the onnxruntime-node package.

## Environment Variables

Make sure to set the following environment variables in your `.env` file:

```
# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
ADMIN_CHAT_ID=your_admin_chat_id
SUPPORT_USERNAME=your_support_username

# Redis Configuration
REDIS_URL=redis://localhost:6379

# Bank Configuration
BANK_USERNAME=your_bank_username
BANK_PASSWORD=your_bank_password
BANK_NAME=MB Bank
BANK_ACCOUNT_NUMBER=your_account_number
BANK_ACCOUNT_NAME=your_account_name

# BasalPay Configuration
BASAL_PAY_API_URL=https://api.basalpay.com/api/v1
BASAL_PAY_ACCESS_TOKEN=your_basal_pay_access_token
BASAL_PAY_FUND_PASSWORD=your_basal_pay_fund_password

# Payment Configuration
PAYMENT_EXPIRY_MINUTES=30
PAYMENT_MARKUP=0

# Transaction Monitoring
TX_CHECK_INTERVAL_MS=15000
```

## Manual Deployment (without Docker Compose)

If you prefer to run without Docker Compose:

### For x86_64 (Intel/AMD)

1. **Build the Docker image**
   ```bash
   docker build -t mbbank-p2p-bot .
   ```

2. **Run the container**
   ```bash
   docker run -d \
     --name mbbank-p2p-bot \
     --env-file .env \
     -v redis-data:/data \
     -p 6379:6379 \
     mbbank-p2p-bot
   ```

### For ARM64 (Apple Silicon M1/M2)

1. **Build the Docker image**
   ```bash
   docker build -t mbbank-p2p-bot-arm64 -f Dockerfile.arm64 .
   ```

2. **Run the container**
   ```bash
   docker run -d \
     --name mbbank-p2p-bot \
     --env-file .env \
     -v redis-data:/data \
     -p 6379:6379 \
     --platform linux/arm64 \
     mbbank-p2p-bot-arm64
   ```

## Troubleshooting

- **Redis Connection Issues**
  
  If the bot has trouble connecting to Redis, check the Redis configuration in your .env file. The Docker setup uses an internal Redis server by default.

- **ONNX Runtime Errors on ARM64**
  
  If you encounter errors related to missing libraries like `ld-linux-aarch64.so.1` when running on ARM64:
  ```
  Error: Error loading shared library ld-linux-aarch64.so.1: No such file or directory
  ```
  Make sure you're using the ARM64-specific Dockerfile and docker-compose files, which use a Debian-based image instead of Alpine.

- **Logs**
  
  Check container logs for debugging:
  ```bash
  docker logs mbbank-p2p-bot
  ```

- **Container Shell Access**
  
  To access the container shell:
  ```bash
  docker exec -it mbbank-p2p-bot /bin/sh
  ```

## Operating Hours

The bot operates from 9:00 AM to 12:00 AM (midnight) Vietnam time (UTC+7).
