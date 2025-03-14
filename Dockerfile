FROM node:20-slim AS builder

# Install build dependencies
RUN apk add --no-cache python3 make g++ \
    && ln -sf python3 /usr/bin/python

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:20-slim AS production

# Install required libraries for ONNX runtime
RUN apk add --no-cache \
    libc6-compat \
    libstdc++ \
    gcompat \
    redis

# Set working directory
WORKDIR /app

# Set environment variables
ENV NODE_ENV=production

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy build artifacts from builder stage
COPY --from=builder /app/dist ./dist
COPY .env* ./

# Create volume for Redis data
VOLUME /data

# Copy startup script 
COPY docker-startup.sh ./
RUN chmod +x docker-startup.sh

# Expose Redis and app ports
EXPOSE 6379
EXPOSE 3000

# Use the startup script as entrypoint
ENTRYPOINT ["./docker-startup.sh"]
