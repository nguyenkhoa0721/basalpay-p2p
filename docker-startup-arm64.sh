#!/bin/sh
# Start Redis server in the background
service redis-server start

# Wait for Redis to become available
echo "Waiting for Redis to start..."
while ! redis-cli ping > /dev/null 2>&1; do
  sleep 1
done
echo "Redis started successfully"

# Start the Node.js application
echo "Starting MBBank P2P Telegram Bot..."
node dist/index.js
