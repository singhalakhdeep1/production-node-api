# Production Node API - Implementation

## Overview
This document describes the monitoring and observability integrations added to Production Node API.

## Technologies Added

### 1. Grafana Loki
- Log aggregation and querying
- Structured logging with labels
- Log stream management
- Label-based filtering
- Time-range queries
- Log level tracking (info, warn, error, debug)
- Contextual logging
- HTTP API integration

### 2. Tempo
- Distributed tracing
- Span creation and management
- Trace ID generation
- Parent-child span relationships
- Operation name tracking
- HTTP middleware for automatic tracing
- Trace search functionality
- Span tags and logs
- OpenTelemetry-compatible format

### 3. AWS CloudWatch
- Custom metrics publishing
- Metric statistics retrieval
- Log group management
- Log event streaming
- Alarm creation and management
- Request/response tracking
- Response time monitoring
- Request count tracking
- AWS SDK integration

### 4. Datadog APM
- Distributed tracing with dd-trace
- Span management
- Async operation tracing
- HTTP request middleware
- Database query tracing
- External call tracing
- Custom metrics (count, gauge, histogram, timing)
- Error tracking with spans
- Tag management
- StatsD integration

### 5. PagerDuty
- Incident triggering
- Incident acknowledgment
- Incident resolution
- Service management
- Incident listing
- Deduplication keys
- Custom alert types (error, latency, error rate)
- Severity levels
- Contextual details
- Events API integration

## Files Created

### Monitoring
- `monitoring/loki.ts` - Grafana Loki log aggregation
- `monitoring/tempo.ts` - Tempo distributed tracing
- `monitoring/cloudwatch.ts` - AWS CloudWatch metrics and logs
- `monitoring/datadog.ts` - Datadog APM tracing and metrics
- `monitoring/pagerduty.ts` - PagerDuty incident management

## Installation

All packages are declared in `package.json` (`@aws-sdk/client-cloudwatch`, `@aws-sdk/client-cloudwatch-logs`, `dd-trace`; Loki, Tempo and PagerDuty use the built-in `fetch`). `npm install` is all that is needed. Sinks are wired in `monitoring/index.ts` and each is enabled only when its environment variables are set.

## Environment Variables

```env
# Grafana Loki
LOKI_URL=http://localhost:3100

# Tempo (query API and OTLP/HTTP receiver)
TEMPO_URL=http://localhost:3200
TEMPO_OTLP_URL=http://localhost:4318

# AWS CloudWatch
CLOUDWATCH_ENABLED=true
CLOUDWATCH_REGION=us-east-1
CLOUDWATCH_LOG_GROUP=node-api-logs
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key

# Datadog
DD_TRACE_ENABLED=true
DD_SERVICE=production-api
DD_ENV=production
DD_AGENT_HOST=localhost
DD_TRACE_AGENT_PORT=8126

# PagerDuty
PAGERDUTY_API_KEY=your_api_key
PAGERDUTY_INTEGRATION_KEY=your_integration_key
```

## Notes
- Every sink call goes through its own circuit breaker; a failing backend never slows down or fails API requests.
- Tempo receives OTLP/HTTP JSON on `/v1/traces` (port 4318); traces can be read back at `/api/ops/traces/:traceId`.
- Loki receives batched pushes every second; query them at `/api/ops/logs`.
- PagerDuty incidents are deduplicated per key and throttled for 5 minutes while open.
- Verified against stub backends (Loki push/query, OTLP, PagerDuty Events v2, CloudWatch and CloudWatch Logs JSON protocols). Not verified against real AWS, Datadog or PagerDuty accounts.
