import Redis from "ioredis";

/**
 * Helper class for Redis operations with better error handling
 */
export class RedisHelper {
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  /**
   * Safely get a hash from Redis
   * @param key The Redis key
   * @returns The hash data or null if not found
   */
  async getHash(key: string): Promise<Record<string, string> | null> {
    try {
      const data = await this.redis.hgetall(key);
      
      if (!data || Object.keys(data).length === 0) {
        return null;
      }
      
      return data;
    } catch (error) {
      console.error(`Error getting hash ${key}:`, error);
      return null;
    }
  }

  /**
   * Safely set a hash in Redis
   * @param key The Redis key
   * @param data The data to set
   * @returns True if successful, false otherwise
   */
  async setHash(key: string, data: Record<string, string>): Promise<boolean> {
    try {
      await this.redis.hset(key, data);
      return true;
    } catch (error) {
      console.error(`Error setting hash ${key}:`, error);
      return false;
    }
  }

  /**
   * Get a payment by ID with better error handling
   * @param paymentId The payment ID
   * @returns The payment data or null if not found
   */
  async getPayment(paymentId: string): Promise<Record<string, string> | null> {
    return this.getHash(`payment:${paymentId}`);
  }

  /**
   * Update a payment's status and additional fields
   * @param paymentId The payment ID
   * @param status The new status
   * @param additionalFields Additional fields to update
   * @returns True if successful, false otherwise
   */
  async updatePaymentStatus(
    paymentId: string, 
    status: string, 
    additionalFields: Record<string, string> = {}
  ): Promise<boolean> {
    try {
      const now = Date.now().toString();
      const data = {
        status,
        [`${status}At`]: now,
        lastUpdated: now,
        ...additionalFields
      };
      
      await this.redis.hset(`payment:${paymentId}`, data);
      return true;
    } catch (error) {
      console.error(`Error updating payment ${paymentId} status:`, error);
      return false;
    }
  }

  /**
   * Get all pending payments
   * @returns Array of payment IDs
   */
  async getPendingPayments(): Promise<string[]> {
    try {
      return await this.redis.smembers("payments:pending");
    } catch (error) {
      console.error("Error getting pending payments:", error);
      return [];
    }
  }

  /**
   * Move a payment from pending to completed
   * @param paymentId The payment ID
   * @returns True if successful, false otherwise
   */
  async completePayment(paymentId: string): Promise<boolean> {
    try {
      await this.redis.srem("payments:pending", paymentId);
      await this.redis.sadd("payments:completed", paymentId);
      return true;
    } catch (error) {
      console.error(`Error completing payment ${paymentId}:`, error);
      return false;
    }
  }

  /**
   * Get a user's active payment
   * @param userId The user ID
   * @returns The payment ID or null if not found
   */
  async getUserActivePayment(userId: string): Promise<string | null> {
    try {
      const paymentId = await this.redis.get(`user:${userId}:activePayment`);
      if (!paymentId) {
        return null;
      }
      return paymentId;
    } catch (error) {
      console.error(`Error getting active payment for user ${userId}:`, error);
      return null;
    }
  }

  /**
   * Set a user's active payment
   * @param userId The user ID
   * @param paymentId The payment ID
   * @returns True if successful, false otherwise
   */
  async setUserActivePayment(userId: string, paymentId: string): Promise<boolean> {
    try {
      await this.redis.set(`user:${userId}:activePayment`, paymentId);
      return true;
    } catch (error) {
      console.error(`Error setting active payment for user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Clear a user's active payment
   * @param userId The user ID
   * @returns True if successful, false otherwise
   */
  async clearUserActivePayment(userId: string): Promise<boolean> {
    try {
      await this.redis.del(`user:${userId}:activePayment`);
      return true;
    } catch (error) {
      console.error(`Error clearing active payment for user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Get expired payments
   * @returns Array of expired payment IDs
   */
  async getExpiredPayments(): Promise<string[]> {
    try {
      const now = Date.now();
      return await this.redis.zrangebyscore("payments:expiry", 0, now);
    } catch (error) {
      console.error("Error getting expired payments:", error);
      return [];
    }
  }

  /**
   * Remove a payment from the expiry set
   * @param paymentId The payment ID
   * @returns True if successful, false otherwise
   */
  async removeFromExpirySet(paymentId: string): Promise<boolean> {
    try {
      await this.redis.zrem("payments:expiry", paymentId);
      return true;
    } catch (error) {
      console.error(`Error removing payment ${paymentId} from expiry set:`, error);
      return false;
    }
  }

  /**
   * Add a payment to the expiry set
   * @param paymentId The payment ID
   * @param expiryTime The expiry time in milliseconds
   * @returns True if successful, false otherwise
   */
  async addToExpirySet(paymentId: string, expiryTime: number): Promise<boolean> {
    try {
      await this.redis.zadd("payments:expiry", expiryTime, paymentId);
      return true;
    } catch (error) {
      console.error(`Error adding payment ${paymentId} to expiry set:`, error);
      return false;
    }
  }
}
