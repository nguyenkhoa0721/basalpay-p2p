# Use Node.js 20 on Debian Bullseye for better compatibility with onnxruntime-node
FROM node:20-bullseye-slim

# Set working directory
WORKDIR /app

# Install system dependencies required for Sharp, onnxruntime-node, and Redis
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    build-essential \
    ca-certificates \
    curl \
    wget \
    redis-server \
    && rm -rf /var/lib/apt/lists/*

# Copy package files first for better caching
COPY package*.json ./

# Install all dependencies (including development dependencies needed for build)
RUN npm ci

# Copy the rest of the application code
COPY . .

# Pre-download the ONNX model to avoid downloading during runtime
RUN mkdir -p /app/model && \
    wget -O /app/model.onnx https://github.com/thedtvn/mbbank-capcha-ocr/raw/refs/heads/master/mb_capcha_ocr/model.onnx

# Build the application
RUN npm run build

# Expose Redis port if needed
EXPOSE 6379

# Create a startup script
RUN echo '#!/bin/bash\nservice redis-server start\nexec "$@"' > /app/docker-entrypoint.sh && \
    chmod +x /app/docker-entrypoint.sh

# Set the entrypoint
ENTRYPOINT ["/app/docker-entrypoint.sh"]

# Default command
CMD ["npm", "start"]
