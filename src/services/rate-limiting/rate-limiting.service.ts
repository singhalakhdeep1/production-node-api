/**
 * Rate Limiting Service (HLD/LLD #2)
 * Token bucket per key (user id or API key id): `bucketCapacity` burst, refilled at
 * `refillRate` tokens/second (fractional tokens kept), idle buckets swept hourly.
 */
interface Bucket {
  tokens: number;
  lastRefillTime: number;
  lastRequestTime: number;
}

export class RateLimitingService {
  readonly bucketCapacity: number;
  readonly refillRate: number;
  private buckets = new Map<string, Bucket>();
  private lastCleanup = new Date();
  private rejected = 0;
  private cleanupTimer: NodeJS.Timeout;

  constructor(options: { bucketCapacity?: number; refillRate?: number } = {}) {
    this.bucketCapacity = options.bucketCapacity ?? 100;
    this.refillRate = options.refillRate ?? 1.0;
    this.cleanupTimer = setInterval(() => this.cleanupExpiredBuckets(), 60 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  private refill(bucket: Bucket, now: number): void {
    const elapsed = (now - bucket.lastRefillTime) / 1000;
    bucket.tokens = Math.min(bucket.tokens + elapsed * this.refillRate, this.bucketCapacity);
    bucket.lastRefillTime = now;
  }

  isAllowed(key: string, tokensRequested = 1): boolean {
    const bucket = this.getOrCreateBucket(key);
    const now = Date.now();
    this.refill(bucket, now);
    if (bucket.tokens >= tokensRequested) {
      bucket.tokens -= tokensRequested;
      bucket.lastRequestTime = now;
      return true;
    }
    this.rejected++;
    return false;
  }

  getRemainingTokens(key: string): number {
    const bucket = this.getOrCreateBucket(key);
    this.refill(bucket, Date.now());
    return Math.floor(bucket.tokens);
  }

  /** Milliseconds until one more token is available (0 when a token is available now). */
  getRetryAfterMs(key: string): number {
    const bucket = this.getOrCreateBucket(key);
    this.refill(bucket, Date.now());
    return bucket.tokens >= 1 ? 0 : Math.ceil(((1 - bucket.tokens) / this.refillRate) * 1000);
  }

  /** Milliseconds until the bucket is full again. */
  getTimeUntilRefill(key: string): number {
    const bucket = this.getOrCreateBucket(key);
    this.refill(bucket, Date.now());
    return Math.ceil(((this.bucketCapacity - bucket.tokens) / this.refillRate) * 1000);
  }

  resetBucket(key: string): void {
    this.buckets.delete(key);
  }

  clearAllBuckets(): void {
    this.buckets.clear();
  }

  getStatistics() {
    return {
      activeBuckets: this.buckets.size,
      bucketCapacity: this.bucketCapacity,
      refillRate: this.refillRate,
      rejectedTotal: this.rejected,
      lastCleanup: this.lastCleanup.toISOString(),
    };
  }

  cleanupExpiredBuckets(maxIdleMs = 60 * 60 * 1000): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastRequestTime > maxIdleMs) {
        this.buckets.delete(key);
        removed++;
      }
    }
    this.lastCleanup = new Date();
    return removed;
  }

  private getOrCreateBucket(key: string): Bucket {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      const now = Date.now();
      bucket = { tokens: this.bucketCapacity, lastRefillTime: now, lastRequestTime: now };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }
}
