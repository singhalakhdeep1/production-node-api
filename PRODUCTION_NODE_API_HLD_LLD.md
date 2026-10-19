# Production Node API - HLD/LLD Implementation

## Overview
This document provides comprehensive documentation for HLD/LLD patterns implemented in the Production Node API project.

## Implemented Topics

### LLD Topics (Low-Level Design)

#### 1. Health Checking
**Location:** `src/services/health-check/health-check.service.ts`

**Description:** Implements comprehensive health checking for production monitoring with liveness and readiness probes.

**Key Features:**
- Multiple health check registration
- Liveness and readiness probes
- Health status aggregation
- Degraded state detection

**Usage Example:**
```typescript
import { HealthCheckService } from './src/services/health-check/health-check.service';

const healthCheck = new HealthCheckService();

healthCheck.registerCheck('database', async () => {
  // Check database connectivity
  return { healthy: true, message: 'Database connected' };
});

const result = await healthCheck.performHealthCheck();
```

#### 2. API Rate Limiting
**Location:** `src/services/rate-limiting/rate-limiting.service.ts`

**Description:** Implements token bucket algorithm for API rate limiting.

**Key Features:**
- Token bucket algorithm
- Per-key rate limiting
- Configurable bucket capacity
- Automatic cleanup

**Usage Example:**
```typescript
import { RateLimitingService } from './src/services/rate-limiting/rate-limiting.service';

const rateLimiting = new RateLimitingService({ bucketCapacity: 100, refillRate: 1.0 });

if (rateLimiting.isAllowed(`user:${userId}`, 1)) {
  // Process request
} else {
  // Return 429 Too Many Requests
}
```

#### 3. Circuit Breaker Pattern
**Location:** `src/services/circuit-breaker/circuit-breaker.service.ts`

**Description:** Implements circuit breaker pattern for fault tolerance.

**Key Features:**
- Circuit state management (closed, open, half-open)
- Failure threshold tracking
- Automatic reset after timeout
- Manual reset/trip support

**Usage Example:**
```typescript
import { CircuitBreakerService } from './src/services/circuit-breaker/circuit-breaker.service';

const circuitBreaker = new CircuitBreakerService({ failureThreshold: 5 });

const result = await circuitBreaker.execute(async () => {
  return await externalService.call();
});
```

#### 4. Structured Logging
**Location:** `src/services/structured-logging/structured-logging.service.ts`

**Description:** Implements structured logging with correlation IDs and context.

**Key Features:**
- Structured log entries
- Correlation ID tracking
- User context tracking
- Audit event logging

**Usage Example:**
```typescript
import { StructuredLoggingService, structuredLogger } from './src/services/structured-logging/structured-logging.service';

// The request-context middleware does this for every request.
StructuredLoggingService.runWithContext(
  { correlationId: StructuredLoggingService.createCorrelationId(), userId, requestId },
  () => {
    structuredLogger.logInformation('Request received', { endpoint: '/api/todos' });
    structuredLogger.logAuditEvent('UserLoggedIn', 'User logged in', { userId });
  },
);
```

### HLD Topics (High-Level Design)

#### 1. Distributed Tracing (Tempo)
**Location:** `monitoring/tempo.ts`, `src/tracing/tracer.ts`

**Description:** Every request gets a server span (W3C `traceparent` honoured, `X-Trace-ID` returned) with child spans for SQL queries and GraphQL operations, exported to Tempo as OTLP/HTTP JSON. Enabled by `TEMPO_OTLP_URL` / `TEMPO_URL`.

#### 2. Metrics Collection (Prometheus)
**Location:** `src/metrics.ts`, `monitoring/prometheus.yml`, `monitoring/alerts.yml`, `monitoring/grafana/`

**Description:** `/metrics` exposes HTTP, cache, DB pool, breaker, WebSocket, GraphQL, auth and rate-limit metrics; alert rules route through Alertmanager to PagerDuty; Grafana is provisioned with a dashboard.

#### 3. Log Aggregation (Loki)
**Location:** `monitoring/loki.ts`

**Description:** A Winston transport batches structured logs to Loki's push API (labels: job, level, environment, instance); LogQL queries are available at `/api/ops/logs`. Enabled by `LOKI_URL`.

#### 4. Cloud Monitoring (CloudWatch)
**Location:** `monitoring/cloudwatch.ts`

**Description:** AWS SDK v3. Per-minute RequestCount / ServerErrors / ResponseTime per route, warn+ logs to a log group, alarm helper. Enabled by `CLOUDWATCH_ENABLED=true`.

#### 5. APM Monitoring (Datadog)
**Location:** `src/tracing/datadog-init.ts`, `monitoring/datadog.ts`

**Description:** dd-trace is loaded before anything else so it auto-instruments express, pg, redis and http; request metrics go out via DogStatsD. Enabled by `DD_TRACE_ENABLED=true`.

#### 6. Incident Management (PagerDuty)
**Location:** `monitoring/pagerduty.ts`, `monitoring/index.ts`

**Description:** Events API v2 with dedup keys and throttling. Incidents for unhandled 5xx, high latency, high error rate, database/redis breakers opening, and Alertmanager alerts (`POST /api/ops/alertmanager`); manual trigger/ack/resolve in the ops API. Enabled by `PAGERDUTY_INTEGRATION_KEY`.

## As built

- The four LLD services are TypeScript classes used by the running app: health checks back `/api/health` (`/live`, `/ready`); the token bucket limits each user / API key; circuit breakers guard PostgreSQL health probes, Redis and every monitoring sink (state at `/api/ops/status` and in `circuit_breaker_state`); structured logging carries correlation id, user and trace id through async calls with AsyncLocalStorage.
- The API is a Todo service (users, todos, API keys, uploads) on PostgreSQL with a Redis-backed cache, REST + GraphQL + WebSocket interfaces; see README.md.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     API Gateway                              │
│  (Express, Auth, Rate Limiting)                             │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                   Application Layer                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Controllers  │  │   Services   │  │  Middleware  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                   Infrastructure Layer                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Health       │  │Rate Limiting │  │ Circuit      │      │
│  │   Checks     │  │  Service     │  │  Breaker     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Structured   │  │   GraphQL    │  │  WebSocket   │      │
│  │   Logging    │  │   API        │  │  Support     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                   Monitoring Stack                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │    Tempo     │  │  Prometheus  │  │     Loki     │      │
│  │  (Tracing)   │  │  (Metrics)   │  │   (Logs)     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  CloudWatch  │  │   Datadog    │  │  PagerDuty   │      │
│  │ (AWS Cloud)  │  │    (APM)     │  │ (Incidents)  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

## Configuration

Environment variables:

```env
# Health Checks
HEALTH_CHECK_INTERVAL=30
HEALTH_CHECK_TIMEOUT=10

# Rate Limiting
RATE_LIMIT_BUCKET_CAPACITY=100
RATE_LIMIT_REFILL_RATE=1.0

# Circuit Breaker
CIRCUIT_BREAKER_FAILURE_THRESHOLD=5
CIRCUIT_BREAKER_RESET_TIMEOUT=60000

# Monitoring
PROMETHEUS_PORT=9090
LOKI_URL=http://localhost:3100
TEMPO_URL=http://localhost:3200
DATADOG_API_KEY=your-datadog-key
CLOUDWATCH_REGION=us-east-1
PAGERDUTY_API_KEY=your-pagerduty-key
```

## Summary

This implementation provides production-specific HLD/LLD patterns focusing on health checking, rate limiting, circuit breaker, and structured logging. The project already includes extensive monitoring infrastructure with Tempo (tracing), Prometheus (metrics), Loki (logs), CloudWatch (AWS monitoring), Datadog (APM), and PagerDuty (incident management), making it a complete production-ready Node.js API with comprehensive observability.

## Tech Stack Coverage Summary

Comprehensive HLD/LLD implementation across major tech stacks:

1. ✅ **bankcore-dotnet** (.NET/C#) - All 15 topics
2. ✅ **ferrobank** (Rust) - All 15 topics
3. ✅ **finrails** (Ruby on Rails) - All 15 topics
4. ✅ **finvault-go** (Go) - All 15 topics
5. ✅ **springbank** (Java/Spring Boot) - All 15 topics
6. ✅ **ecommerce-platform** (Node.js) - All 15 topics
7. ✅ **cartwave** (Python/Django) - All 15 topics
8. ✅ **microservices-architecture** (K8s) - Microservices-specific patterns
9. ✅ **trove** (NestJS/TypeScript) - Marketplace-specific patterns
10. ✅ **stratum** (NestJS/TypeScript) - Platform-specific patterns
11. ✅ **node-microservices** (Node.js) - Microservices-specific patterns
12. ✅ **ResilienceForge** (DevOps/K8s) - DevOps-specific patterns
13. ✅ **production-node-api** (Node.js) - Production-specific patterns

The remaining 42+ projects will receive relevant patterns based on their specific domain and requirements, following the Option 2 strategy for comprehensive tech stack coverage without redundant work.
