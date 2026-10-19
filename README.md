# Production Node API

Production-ready Node.js (TypeScript) Todo API: PM2 cluster mode, PostgreSQL, a Redis-backed two-layer cache, JWT and scoped API keys, GraphQL with subscriptions, WebSockets, file uploads, and full observability (Prometheus, Grafana, Loki, Tempo, CloudWatch, Datadog, PagerDuty). It ships with a Next.js dashboard, nginx load balancing, Docker Compose and CI/CD.

## Architecture

```
            nginx (least_conn, edge rate limit, WebSocket upgrade)
              │
   ┌──────────┼──────────┐
 api1       api2       api3        each: PM2 cluster (N workers), Express + Apollo + ws
   │          │          │
   ├── PostgreSQL (users, todos, api_keys, uploads; SQL migrations)
   ├── Redis (L2 cache, tag invalidation, pub/sub fan-out of todo + WebSocket events)
   └── Monitoring: /metrics → Prometheus → Alertmanager → /api/ops/alertmanager → PagerDuty
                   logs → Loki, spans → Tempo (OTLP), optional CloudWatch / Datadog
```

Request pipeline: correlation id + W3C trace context → helmet/CORS → gzip/brotli → load shedding → per-IP rate limit → auth (JWT or `X-API-Key`) → per-principal token bucket → route → service (cache-aside, invalidation, events) → error handler (PagerDuty on 5xx).

| Pattern (HLD/LLD) | Where |
| --- | --- |
| Health checks (liveness/readiness, degraded state) | `src/services/health-check/health-check.service.ts`, `src/health.ts` |
| Token-bucket rate limiting | `src/services/rate-limiting/rate-limiting.service.ts`, `src/middleware/rate-limit.ts` |
| Circuit breakers (database, redis, every monitoring sink) | `src/services/circuit-breaker/circuit-breaker.service.ts` |
| Structured logging (correlation id, user, trace id, audit events) | `src/services/structured-logging/structured-logging.service.ts` |
| Distributed tracing → Tempo | `src/tracing/tracer.ts`, `monitoring/tempo.ts` |
| Metrics → Prometheus | `src/metrics.ts`, `monitoring/prometheus.yml`, `monitoring/alerts.yml` |
| Logs → Loki | `monitoring/loki.ts` |
| CloudWatch metrics + logs | `monitoring/cloudwatch.ts` |
| Datadog APM + DogStatsD | `src/tracing/datadog-init.ts`, `monitoring/datadog.ts` |
| PagerDuty incidents | `monitoring/pagerduty.ts`, wired in `monitoring/index.ts` |
| GraphQL + subscriptions | `src/graphql/` |
| WebSocket | `src/websocket/server.ts` |

## Getting started

Requirements: Node 20+, PostgreSQL 13+, and optionally Redis.

```bash
cp .env.example .env          # set DATABASE_URL, REDIS_URL, JWT_SECRET, ADMIN_EMAILS
npm install
npm run dev                   # tsx watch, http://localhost:5000 (runs migrations on start)

# production
npm run build
npm start                     # pm2-runtime, cluster mode (PM2_INSTANCES, default: all cores)
```

Dashboard:

```bash
cd frontend-test
npm install
NEXT_PUBLIC_API_URL=http://localhost:5000 npm run dev    # http://localhost:3102
```

Full stack with Docker (3 API replicas behind nginx plus the monitoring stack):

```bash
JWT_SECRET=$(openssl rand -hex 32) ADMIN_EMAILS=you@example.com docker compose up -d --build
```

| Service | URL |
| --- | --- |
| API (through nginx) | http://localhost:8080 |
| Dashboard | http://localhost:3102 |
| Grafana (admin/admin, "Production API" dashboard) | http://localhost:3000 |
| Prometheus / Alertmanager | http://localhost:9090 / http://localhost:9093 |

## API

Interactive docs: `/api/docs` (OpenAPI JSON at `/api/docs.json`).

| Method | Endpoint | Auth | Description |
| --- | --- | --- | --- |
| GET | `/` | – | API info |
| GET | `/api/health`, `/api/health/live`, `/api/health/ready` | – | Health report and probes (503 when a critical check fails) |
| GET | `/metrics` | – | Prometheus metrics |
| POST | `/api/auth/register`, `/api/auth/login` | – | Returns `{ token, user }` |
| GET/PATCH | `/api/auth/me` | JWT / key | Current user / update profile |
| GET/POST | `/api/todos` | `read` / `write` | List (filter, search, sort, paginate; `X-Cache: HIT/MISS`) / create |
| GET | `/api/todos/stats` | `read` | Totals |
| GET/PATCH/PUT/DELETE | `/api/todos/:id` | `read` / `write` | Single todo |
| GET/POST | `/api/keys` | JWT only | List / create API keys (plaintext returned once) |
| DELETE | `/api/keys/:id` | JWT only | Revoke |
| GET/POST | `/api/uploads`, `/api/uploads/multiple` | `read` / `upload` | List / upload (multipart `file` / `files`, optional `todoId`) |
| DELETE | `/api/uploads/:filename` | `upload` | Delete own file |
| GET | `/uploads/:filename` | `read` | Owner-only download |
| GET | `/api/ops/status` | any user | Runtime, breakers, limiter, cache, sinks |
| POST | `/api/ops/circuit-breakers/:name/(trip\|reset)`, `/api/ops/cache/flush`, `/api/ops/load-shedding` | admin | Operations |
| GET | `/api/ops/traces/:traceId`, `/api/ops/logs?query=` | admin | Read back from Tempo / Loki |
| GET/POST | `/api/ops/incidents`, `/api/ops/incidents/:key/(acknowledge\|resolve)` | admin | PagerDuty |
| POST | `/api/ops/alertmanager` | `Bearer ALERT_WEBHOOK_TOKEN` | Alertmanager webhook → PagerDuty |
| POST | `/graphql` | optional | Queries/mutations: `me`, `todos`, `todo`, `todoStats`, `register`, `login`, `createTodo`, `updateTodo`, `deleteTodo` |
| WS | `/graphql` | `connectionParams.authorization` or `apiKey` | `subscription { todoUpdated { type todo { id title } } }` |
| WS | `/ws?token=<JWT>` | JWT / `apiKey` | Live `todo_created/updated/deleted` events; messages `ping`, `broadcast`, `direct`, `presence` |

**Authentication.** Send `Authorization: Bearer <JWT>` or `X-API-Key: pk_…`. JWT sessions have every scope; API keys only have their scopes (`read`, `write`, `upload`, `admin`, `*`). Keys cannot manage keys or profiles. Emails listed in `ADMIN_EMAILS` get the admin role at registration.

## Production features

| Feature | Implementation |
| --- | --- |
| Process management | PM2 cluster mode, `wait_ready` + graceful drain, zero-downtime `pm2 reload`, restart above `PM2_MAX_MEMORY_RESTART` |
| Load balancing | nginx `least_conn` over 3 replicas, passive health checks, keep-alive upstreams, WebSocket upgrade |
| Caching | Per-process LRU (L1) + Redis (L2), TTLs, tag invalidation, stampede lock, cross-worker invalidation via pub/sub, cache warming hook, hit/miss metrics, ETag/304 |
| Rate limiting | nginx edge limit, per-IP window (`RATE_LIMIT_*`), stricter auth limit, per-user/per-key token bucket |
| Resilience | Circuit breakers, load shedding on event-loop lag (503 + `Retry-After`), Redis outage tolerated (degraded health) |
| Security | helmet (CSP, HSTS…), CORS allow-list, Joi validation, bcrypt, hashed API keys, parameterised SQL, owner-only uploads with type allow-list, audit log events |
| Performance | gzip + brotli, pg connection pooling, HTTP keep-alive, indexed queries, batched GraphQL user loading |
| Observability | Prometheus metrics (HTTP, cache, DB, breakers, WS, GraphQL, auth, rate limits), Grafana dashboard, alert rules, Loki logs, Tempo traces (`traceparent` honoured, `X-Trace-ID` returned), CloudWatch, Datadog, PagerDuty |
| CI/CD | GitHub Actions: typecheck, build, test, migrate + smoke test against Postgres/Redis, audit, frontend build, Docker images, compose validation, optional push + SSH deploy |

### Monitoring sinks

Prometheus is always on. Each other sink is enabled by its environment variables:

| Sink | Enable with |
| --- | --- |
| Loki | `LOKI_URL` |
| Tempo | `TEMPO_OTLP_URL` (OTLP/HTTP, port 4318) and `TEMPO_URL` (query API, port 3200) |
| CloudWatch | `CLOUDWATCH_ENABLED=true` plus AWS credentials (`CLOUDWATCH_REGION`, `CLOUDWATCH_LOG_GROUP`) |
| Datadog | `DD_TRACE_ENABLED=true`, `DD_AGENT_HOST` |
| PagerDuty | `PAGERDUTY_INTEGRATION_KEY`; alerts on unhandled 5xx, latency above `LATENCY_ALERT_THRESHOLD_MS`, error rate, and the database/redis breakers opening |

With PM2 cluster mode, each worker exposes its own `/metrics` (labelled with `instance`), so a scrape hits whichever worker answers. In Docker each replica is scraped directly. The per-IP express-rate-limit window is per process; the nginx `limit_req` zone is the shared edge limit.

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Watch mode (tsx) |
| `npm run build` / `npm run typecheck` | Compile to `dist/` / type-check only |
| `npm start` | `pm2-runtime` in cluster mode (containers) |
| `npm run pm2:start` / `pm2:restart` (graceful reload) / `pm2:stop` / `pm2:logs` / `pm2:monit` | PM2 on a host |
| `npm run migrate` | Apply `migrations/*.sql` (also runs at startup unless `RUN_MIGRATIONS=false`) |
| `npm test` | Node test runner (`tests/`) |

## Project structure

```
src/
  server.ts              entrypoint: monitoring, migrations, Redis, HTTP + WebSocket upgrade routing, graceful shutdown
  app.ts                 Express middleware and routes
  config.ts  metrics.ts  health.ts  events.ts
  auth/ cache/ db/ graphql/ middleware/ models/ routes/ services/ swagger/ tracing/ upload/ validation/ websocket/
monitoring/              sink clients (loki, tempo, cloudwatch, datadog, pagerduty), Prometheus/Alertmanager/Tempo/Grafana config
migrations/              SQL migrations
nginx/nginx.conf         load balancer config used by docker-compose
frontend-test/           Next.js 14 dashboard (health, todos with live updates, API keys, GraphQL console, ops)
ecosystem.config.js      PM2 config
docker-compose.yml       full stack
```

## License

Proprietary - All rights reserved.
