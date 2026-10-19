/**
 * Two-layer cache: per-process LRU (L1, short TTL) in front of Redis (L2).
 * - TTL expiry on both layers; tags (Redis sets) for selective invalidation
 * - cache-aside `wrap()` with a Redis SET NX lock so only one worker rebuilds a hot key
 * - invalidations are broadcast on a pub/sub channel so other PM2 workers drop their L1 copy
 * - every Redis call goes through a circuit breaker; when Redis is down the API keeps working
 *   from L1/Postgres and /api/health reports the cache as degraded.
 */
import { createClient } from 'redis';
import { config } from '../config';
import { cacheOperations } from '../metrics';
import { CircuitBreakerService } from '../services/circuit-breaker/circuit-breaker.service';
import { logger } from '../services/structured-logging/structured-logging.service';

type RedisClient = ReturnType<typeof createClient>;
const INVALIDATION_CHANNEL = 'cache:invalidate';
const PREFIX = 'pna:';

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

class MemoryLru {
  private map = new Map<string, MemoryEntry>();
  constructor(private readonly max: number, private readonly ttlSeconds: number) {}

  get(key: string): string | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: string, ttlSeconds: number): void {
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: Date.now() + Math.min(ttlSeconds, this.ttlSeconds) * 1000 });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  deletePrefix(prefix: string): void {
    for (const key of this.map.keys()) if (key.startsWith(prefix)) this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

export class RedisCache {
  client: RedisClient | null = null;
  private subscriber: RedisClient | null = null;
  private memory = new MemoryLru(config.redis.memoryCacheMax, config.redis.memoryCacheTtl);
  private breaker = new CircuitBreakerService({ name: 'redis', failureThreshold: 3, resetTimeout: 10000 });
  private messageHandlers = new Map<string, Set<(message: string) => void>>();
  isConnected = false;
  stats = { l1Hits: 0, l2Hits: 0, misses: 0, sets: 0, invalidations: 0 };

  get enabled(): boolean {
    return Boolean(config.redis.url);
  }

  async connect(): Promise<void> {
    if (!this.enabled) {
      logger.warn('REDIS_URL not set: running with the in-memory cache only');
      return;
    }
    const options = {
      url: config.redis.url,
      password: config.redis.password,
      socket: { reconnectStrategy: (retries: number) => Math.min(retries * 200, 5000), connectTimeout: 5000 },
    };
    this.client = createClient(options);
    this.client.on('error', (err: Error) => {
      if (this.isConnected) logger.error('Redis client error', { error: err.message });
      this.isConnected = false;
    });
    this.client.on('ready', () => {
      this.isConnected = true;
      logger.info('Redis connected');
    });
    this.client.on('end', () => {
      this.isConnected = false;
    });

    try {
      await this.client.connect();
      this.subscriber = this.client.duplicate();
      this.subscriber.on('error', () => undefined);
      await this.subscriber.connect();
      await this.subscriber.subscribe(INVALIDATION_CHANNEL, (message) => {
        const { origin, keys, prefixes } = JSON.parse(message) as { origin: string; keys: string[]; prefixes: string[] };
        if (origin === config.instance) return;
        keys.forEach((k) => this.memory.delete(k));
        prefixes.forEach((p) => this.memory.deletePrefix(p));
      });
    } catch (error) {
      logger.error('Failed to connect to Redis; continuing with the in-memory cache', { error: (error as Error).message });
      this.isConnected = false;
    }
  }

  private async redis<T>(op: (client: RedisClient) => Promise<T>): Promise<T | undefined> {
    if (!this.client || !this.isConnected) return undefined;
    try {
      return await this.breaker.execute(() => op(this.client as RedisClient));
    } catch (error) {
      logger.debug?.('Redis operation failed', { error: (error as Error).message });
      return undefined;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const memoryValue = this.memory.get(key);
    if (memoryValue !== undefined) {
      this.stats.l1Hits++;
      cacheOperations.inc({ layer: 'memory', result: 'hit' });
      return JSON.parse(memoryValue) as T;
    }
    cacheOperations.inc({ layer: 'memory', result: 'miss' });
    const data = await this.redis((c) => c.get(PREFIX + key));
    if (data) {
      this.stats.l2Hits++;
      cacheOperations.inc({ layer: 'redis', result: 'hit' });
      this.memory.set(key, data, config.redis.memoryCacheTtl);
      return JSON.parse(data) as T;
    }
    if (this.isConnected) cacheOperations.inc({ layer: 'redis', result: 'miss' });
    this.stats.misses++;
    return null;
  }

  async set(key: string, value: unknown, ttl = config.redis.ttl, tags: string[] = []): Promise<boolean> {
    const payload = JSON.stringify(value);
    this.memory.set(key, payload, ttl);
    this.stats.sets++;
    const ok = await this.redis(async (c) => {
      const multi = c.multi().setEx(PREFIX + key, ttl, payload);
      for (const tag of tags) {
        multi.sAdd(`${PREFIX}tag:${tag}`, key);
        multi.expire(`${PREFIX}tag:${tag}`, ttl * 2);
      }
      await multi.exec();
      return true;
    });
    return ok ?? false;
  }

  /** Cache-aside with stampede protection: one caller rebuilds, the rest wait briefly for it. */
  async wrap<T>(key: string, ttl: number, tags: string[], loader: () => Promise<T>): Promise<{ value: T; cached: boolean }> {
    const cached = await this.get<T>(key);
    if (cached !== null) return { value: cached, cached: true };

    const lockKey = `${PREFIX}lock:${key}`;
    const gotLock = await this.redis((c) => c.set(lockKey, config.instance, { NX: true, PX: 5000 }));
    if (gotLock === null) {
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 50));
        const value = await this.get<T>(key);
        if (value !== null) return { value, cached: true };
      }
    }
    try {
      const value = await loader();
      await this.set(key, value, ttl, tags);
      return { value, cached: false };
    } finally {
      if (gotLock) await this.redis((c) => c.del(lockKey));
    }
  }

  async del(key: string): Promise<boolean> {
    this.memory.delete(key);
    await this.publishInvalidation([key], []);
    return (await this.redis((c) => c.del(PREFIX + key))) !== undefined;
  }

  /** Drops every key stored with `tag` (on all workers). */
  async invalidateTag(tag: string): Promise<number> {
    this.stats.invalidations++;
    const keys = (await this.redis((c) => c.sMembers(`${PREFIX}tag:${tag}`))) ?? [];
    keys.forEach((k) => this.memory.delete(k));
    if (keys.length) await this.redis((c) => c.del([...keys.map((k) => PREFIX + k), `${PREFIX}tag:${tag}`]));
    // L1 entries can exist without the Redis tag set (Redis down): keys are prefixed with the tag.
    this.memory.deletePrefix(`${tag}:`);
    await this.publishInvalidation(keys, [`${tag}:`]);
    return keys.length;
  }

  async delPattern(pattern: string): Promise<number> {
    const prefix = pattern.replace(/\*$/, '');
    this.memory.deletePrefix(prefix);
    let removed = 0;
    await this.redis(async (c) => {
      for await (const batch of c.scanIterator({ MATCH: PREFIX + pattern, COUNT: 200 })) {
        const keys = Array.isArray(batch) ? batch : [batch];
        if (keys.length) removed += await c.del(keys);
      }
    });
    await this.publishInvalidation([], [prefix]);
    return removed;
  }

  async exists(key: string): Promise<boolean> {
    if (this.memory.get(key) !== undefined) return true;
    return (await this.redis((c) => c.exists(PREFIX + key))) === 1;
  }

  async incr(key: string, ttl?: number): Promise<number | null> {
    const value = await this.redis(async (c) => {
      const n = await c.incr(PREFIX + key);
      if (ttl && n === 1) await c.expire(PREFIX + key, ttl);
      return n;
    });
    return value ?? null;
  }

  async expire(key: string, ttl: number): Promise<boolean> {
    return (await this.redis((c) => c.expire(PREFIX + key, ttl))) ?? false;
  }

  async flushAll(): Promise<void> {
    this.memory.clear();
    await this.delPattern('*');
  }

  /** Warms the cache by running loaders ahead of traffic (used at startup for hot keys). */
  async warm(entries: { key: string; ttl: number; tags: string[]; loader: () => Promise<unknown> }[]): Promise<number> {
    let warmed = 0;
    for (const entry of entries) {
      try {
        await this.set(entry.key, await entry.loader(), entry.ttl, entry.tags);
        warmed++;
      } catch (error) {
        logger.warn('Cache warm failed', { key: entry.key, error: (error as Error).message });
      }
    }
    return warmed;
  }

  private async publishInvalidation(keys: string[], prefixes: string[]): Promise<void> {
    await this.redis((c) => c.publish(INVALIDATION_CHANNEL, JSON.stringify({ origin: config.instance, keys, prefixes })));
  }

  /** Generic pub/sub used for cross-worker event fan-out (todo events, WebSocket messages). */
  async publish(channel: string, message: string): Promise<boolean> {
    return (await this.redis((c) => c.publish(channel, message))) !== undefined;
  }

  async subscribe(channel: string, handler: (message: string) => void): Promise<boolean> {
    if (!this.subscriber || !this.isConnected) return false;
    let handlers = this.messageHandlers.get(channel);
    if (!handlers) {
      handlers = new Set();
      this.messageHandlers.set(channel, handlers);
      const set = handlers;
      await this.subscriber.subscribe(channel, (message) => set.forEach((h) => h(message)));
    }
    handlers.add(handler);
    return true;
  }

  async ping(): Promise<number> {
    if (!this.client || !this.isConnected) throw new Error('Redis not connected');
    const start = Date.now();
    await this.client.ping();
    return Date.now() - start;
  }

  snapshot() {
    return {
      enabled: this.enabled,
      connected: this.isConnected,
      memoryEntries: this.memory.size,
      breaker: this.breaker.getState(),
      ...this.stats,
    };
  }

  async disconnect(): Promise<void> {
    await this.subscriber?.quit().catch(() => undefined);
    await this.client?.quit().catch(() => undefined);
    this.isConnected = false;
  }
}

export const cache = new RedisCache();
