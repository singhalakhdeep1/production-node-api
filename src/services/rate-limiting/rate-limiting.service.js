/**
 * Rate Limiting Service for Production Node API
 * Implements token bucket algorithm for API rate limiting
 */
class RateLimitingService {
  constructor(options = {}) {
    this.bucketCapacity = options.bucketCapacity || 100;
    this.refillRate = options.refillRate || 1.0; // tokens per second
    this.buckets = new Map();
  }

  isAllowed(key, tokensRequested = 1) {
    const bucket = this.getOrCreateBucket(key);

    const now = Date.now();
    const timeSinceLastRefill = (now - bucket.lastRefillTime) / 1000;

    // Refill tokens based on time elapsed
    const tokensToAdd = Math.floor(timeSinceLastRefill * this.refillRate);
    bucket.tokens = Math.min(bucket.tokens + tokensToAdd, this.bucketCapacity);
    bucket.lastRefillTime = now;

    // Check if enough tokens available
    if (bucket.tokens >= tokensRequested) {
      bucket.tokens -= tokensRequested;
      bucket.lastRequestTime = now;

      console.debug(`Request allowed for key: ${key} (Tokens remaining: ${bucket.tokens})`);
      return true;
    } else {
      console.warn(`Request rate limited for key: ${key} (Tokens needed: ${tokensRequested}, Available: ${bucket.tokens})`);
      return false;
    }
  }

  getRemainingTokens(key) {
    const bucket = this.getOrCreateBucket(key);

    const now = Date.now();
    const timeSinceLastRefill = (now - bucket.lastRefillTime) / 1000;
    const tokensToAdd = Math.floor(timeSinceLastRefill * this.refillRate);
    bucket.tokens = Math.min(bucket.tokens + tokensToAdd, this.bucketCapacity);
    bucket.lastRefillTime = now;

    return bucket.tokens;
  }

  getTimeUntilRefill(key) {
    const remaining = this.getRemainingTokens(key);

    if (remaining < this.bucketCapacity) {
      const tokensNeeded = this.bucketCapacity - remaining;
      const secondsToWait = tokensNeeded / this.refillRate;
      return secondsToWait * 1000; // milliseconds
    } else {
      return 0;
    }
  }

  resetBucket(key) {
    this.buckets.delete(key);
    console.debug(`Reset bucket for key: ${key}`);
  }

  getStatistics() {
    return {
      activeBuckets: this.buckets.size,
      bucketCapacity: this.bucketCapacity,
      refillRate: this.refillRate,
      lastCleanup: new Date()
    };
  }

  clearAllBuckets() {
    this.buckets.clear();
    console.warn('Cleared all rate limit buckets');
  }

  cleanupExpiredBuckets() {
    const now = Date.now();
    const oneHour = 3600000;

    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastRequestTime > oneHour) {
        this.buckets.delete(key);
        console.debug(`Removed expired bucket: ${key}`);
      }
    }

    console.log(`Rate limit bucket cleanup completed. Active buckets: ${this.buckets.size}`);
  }

  getOrCreateBucket(key) {
    if (!this.buckets.has(key)) {
      this.buckets.set(key, {
        tokens: this.bucketCapacity,
        lastRefillTime: Date.now(),
        lastRequestTime: Date.now(),
        createdAt: Date.now()
      });
    }
    return this.buckets.get(key);
  }
}

module.exports = RateLimitingService;
