# Production Node API - Expansion Status

This file lists the expansion features and where each one lives in the code. "Not implemented" items are listed honestly instead of being claimed. Setup and API details are in README.md.

## 1. Monitoring

| Feature | Status | Where |
| --- | --- | --- |
| Prometheus metrics (request rate, latency, sizes, in-flight, CPU/memory/heap, event loop, GC) | ✅ | `src/metrics.ts`, `/metrics` |
| Custom metrics (cache, DB pool, breakers, WebSockets, GraphQL, auth, rate limits, load shedding, uploads) | ✅ | `src/metrics.ts` |
| Grafana dashboards | ✅ | `monitoring/grafana/` (provisioned datasources + "Production API" dashboard) |
| Alerting rules + Alertmanager | ✅ | `monitoring/alerts.yml`, `monitoring/alertmanager.yml` → PagerDuty bridge |
| APM | ✅ | Datadog (`dd-trace`), Tempo tracing |
| Log aggregation | ✅ | Winston JSON → Loki (and CloudWatch Logs); ELK is not used |
| Error tracking | ✅ partial | PagerDuty incidents for unhandled 5xx + Datadog error spans. Sentry is **not implemented**. |
| Uptime monitoring | ✅ | `/api/health/live`, `/api/health/ready`, Docker HEALTHCHECK, `ServiceDown` alert |
| Synthetic monitoring, Real User Monitoring | ❌ not implemented | |

## 2. Caching

| Feature | Status | Where |
| --- | --- | --- |
| Redis distributed cache | ✅ | `src/cache/redis.ts` |
| In-memory cache (per process) | ✅ | L1 LRU in `src/cache/redis.ts` |
| HTTP caching headers | ✅ | Strong ETags / 304, `Cache-Control` on todo and upload responses |
| API response / DB query caching | ✅ | `TodoService` cache-aside (`src/services/todo.service.ts`) |
| TTL expiry, tag invalidation, cache warming hook | ✅ | `set(..., ttl, tags)`, `invalidateTag`, `warm()` |
| Distributed lock against cache stampedes | ✅ | `wrap()` uses Redis `SET NX PX` |
| Cross-worker invalidation | ✅ | Redis pub/sub channel `cache:invalidate` |
| Hit/miss metrics, fallback when Redis is down | ✅ | `cache_operations_total`; circuit breaker + L1/DB fallback |
| CDN caching, cache compression | ❌ not implemented | |

## 3. Load balancing

| Feature | Status | Where |
| --- | --- | --- |
| PM2 cluster mode, automatic restart, memory limit | ✅ | `ecosystem.config.js` |
| Graceful shutdown + zero-downtime reload | ✅ | `wait_ready`, `process.send('ready')`, drain in `src/server.ts` |
| Nginx reverse proxy, least-connections, passive health checks | ✅ | `nginx/nginx.conf` (round-robin / ip_hash are one-line changes) |
| Rate limiting, load shedding | ✅ | nginx `limit_req`, `src/middleware/rate-limit.ts`, `src/middleware/load-shedding.ts` |
| Circuit breaker integration | ✅ | `src/services/circuit-breaker/` |
| Geographic load balancing, canary traffic splitting, request queuing | ❌ not implemented | |

## 4. Security

| Feature | Status | Where |
| --- | --- | --- |
| Helmet headers (CSP, HSTS, X-Frame-Options, nosniff) | ✅ | `src/app.ts` |
| CORS allow-list | ✅ | `CORS_ORIGINS` |
| Input validation (Joi) | ✅ | `src/validation/schemas.ts` |
| SQL injection prevention | ✅ | Parameterised queries only; sort columns whitelisted |
| XSS | ✅ | JSON-only API, CSP, nosniff on downloads |
| CSRF | ✅ n/a | Bearer/API-key auth (no cookies); Apollo CSRF prevention enabled |
| JWT validation, API key management with scopes | ✅ | `src/auth/`, `src/middleware/auth.ts`, `/api/keys` |
| Authorization (scopes, admin role, ownership checks) | ✅ | `requireScope`, `requireRole`, per-user queries |
| Security audit logging | ✅ | `logAuditEvent` (register, login, failed login, keys, uploads, ops actions) |
| Encrypted secrets | ❌ not implemented | Secrets come from the environment / your secret manager |

## 5. Performance

| Feature | Status | Where |
| --- | --- | --- |
| gzip + brotli compression | ✅ | `compression` 1.8 (`ENABLE_BROTLI`) and nginx gzip |
| Connection pooling | ✅ | `pg` pool (`DB_POOL_MIN/MAX`), nginx upstream keep-alive |
| Keep-alive | ✅ | `server.keepAliveTimeout` tuned above the nginx timeout |
| Index optimisation | ✅ | `migrations/*.sql` |
| N+1 avoidance | ✅ | Batched user loader in `src/graphql/server.ts` |
| Memory leak detection | ✅ partial | RSS health check, `HighMemoryUsage` alert, PM2 memory restart |
| HTTP/2 | ✅ at the edge | TLS server block in `nginx/nginx.conf` (commented, needs certificates) |
| Load testing, profiling tooling | ❌ not included | |

## Other technologies

PostgreSQL, Apollo GraphQL (subscriptions via graphql-ws), `ws` WebSockets, Multer uploads, Swagger UI (`/api/docs`), GitHub Actions CI/CD, Docker Compose.
