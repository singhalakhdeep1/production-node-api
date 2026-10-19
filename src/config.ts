import 'dotenv/config';

const num = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(parsed) ? parsed : fallback;
};
const bool = (value: string | undefined, fallback = false): boolean =>
  value === undefined || value === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
const list = (value: string | undefined): string[] =>
  (value ?? '').split(',').map((v) => v.trim()).filter(Boolean);

const nodeEnv = process.env.NODE_ENV ?? 'development';

export const config = {
  env: nodeEnv,
  isProduction: nodeEnv === 'production',
  port: num(process.env.PORT, 5000),
  serviceName: process.env.SERVICE_NAME ?? 'production-api',
  version: process.env.APP_VERSION ?? '2.0.0',
  instance: process.env.NODE_APP_INSTANCE ?? process.env.HOSTNAME ?? String(process.pid),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  logDir: process.env.LOG_DIR ?? 'logs',
  corsOrigins: list(process.env.CORS_ORIGINS ?? 'http://localhost:3102'),
  trustProxy: process.env.TRUST_PROXY ?? 'loopback',

  db: {
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/production_api',
    poolMin: num(process.env.DB_POOL_MIN, 2),
    poolMax: num(process.env.DB_POOL_MAX, 20),
    ssl: bool(process.env.DB_SSL),
  },

  redis: {
    url: process.env.REDIS_URL ?? '',
    password: process.env.REDIS_PASSWORD || undefined,
    ttl: num(process.env.REDIS_TTL, 3600),
    memoryCacheMax: num(process.env.MEMORY_CACHE_MAX_ENTRIES, 500),
    memoryCacheTtl: num(process.env.MEMORY_CACHE_TTL, 30),
  },

  auth: {
    jwtSecret: process.env.JWT_SECRET ?? 'dev-only-change-me',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
    bcryptRounds: num(process.env.BCRYPT_ROUNDS, 10),
    adminEmails: list(process.env.ADMIN_EMAILS).map((e) => e.toLowerCase()),
    apiKeyDefaultTtlDays: num(process.env.API_KEY_TTL_DAYS, 365),
  },

  rateLimit: {
    windowMs: num(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    max: num(process.env.RATE_LIMIT_MAX_REQUESTS, 100),
    bucketCapacity: num(process.env.RATE_LIMIT_BUCKET_CAPACITY, 100),
    refillRate: num(process.env.RATE_LIMIT_REFILL_RATE, 1.0),
  },

  circuitBreaker: {
    failureThreshold: num(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD, 5),
    resetTimeout: num(process.env.CIRCUIT_BREAKER_RESET_TIMEOUT, 60000),
  },

  health: {
    intervalSeconds: num(process.env.HEALTH_CHECK_INTERVAL, 30),
    timeoutSeconds: num(process.env.HEALTH_CHECK_TIMEOUT, 10),
  },

  loadShedding: {
    maxEventLoopDelayMs: num(process.env.LOAD_SHED_MAX_EVENT_LOOP_DELAY_MS, 500),
  },

  compression: {
    level: num(process.env.COMPRESSION_LEVEL, 6),
    brotli: bool(process.env.ENABLE_BROTLI, true),
  },

  uploads: {
    path: process.env.UPLOAD_PATH ?? './uploads',
    maxFileSize: num(process.env.UPLOAD_MAX_FILE_SIZE, 10 * 1024 * 1024),
  },

  monitoring: {
    lokiUrl: process.env.LOKI_URL ?? '',
    tempoUrl: process.env.TEMPO_URL ?? '',
    tempoOtlpUrl: process.env.TEMPO_OTLP_URL ?? '',
    cloudwatchEnabled: bool(process.env.CLOUDWATCH_ENABLED),
    cloudwatchRegion: process.env.CLOUDWATCH_REGION ?? process.env.AWS_REGION ?? 'us-east-1',
    cloudwatchNamespace: process.env.CLOUDWATCH_NAMESPACE ?? 'NodeAPI',
    cloudwatchLogGroup: process.env.CLOUDWATCH_LOG_GROUP ?? 'node-api-logs',
    cloudwatchEndpoint: process.env.CLOUDWATCH_ENDPOINT || undefined,
    datadogEnabled: bool(process.env.DD_TRACE_ENABLED),
    pagerdutyIntegrationKey: process.env.PAGERDUTY_INTEGRATION_KEY ?? '',
    pagerdutyApiKey: process.env.PAGERDUTY_API_KEY ?? '',
    pagerdutyEventsUrl: process.env.PAGERDUTY_EVENTS_URL ?? 'https://events.pagerduty.com/v2/enqueue',
    pagerdutyApiUrl: process.env.PAGERDUTY_API_URL ?? 'https://api.pagerduty.com',
    latencyAlertThresholdMs: num(process.env.LATENCY_ALERT_THRESHOLD_MS, 2000),
    alertWebhookToken: process.env.ALERT_WEBHOOK_TOKEN ?? '',
  },
};

if (config.isProduction && config.auth.jwtSecret === 'dev-only-change-me') {
  throw new Error('JWT_SECRET must be set in production');
}

export type AppConfig = typeof config;
