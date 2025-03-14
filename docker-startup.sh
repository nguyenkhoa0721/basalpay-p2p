#!/bin/sh
# Start Redis server in the background
redis-server --daemonize yes

# Wait for Redis to become available
echo "Waiting for Redis to start..."
while ! redis-cli ping > /dev/null 2>&1; do
  sleep 1
done
echo "Redis started successfully"

# Start the Node.js application
echo "Starting MBBank P2P Telegram Bot..."
node dist/index.js
