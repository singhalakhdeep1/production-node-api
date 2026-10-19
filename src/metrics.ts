import promClient from 'prom-client';
import { config } from './config';

export const register = new promClient.Registry();
register.setDefaultLabels({ service: config.serviceName, instance: config.instance });
promClient.collectDefaultMetrics({ register, eventLoopMonitoringPrecision: 20 });

const sizeBuckets = [100, 1000, 10000, 100000, 1000000, 10000000];

export const httpRequestsTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

export const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

export const httpRequestSize = new promClient.Histogram({
  name: 'http_request_size_bytes',
  help: 'Size of HTTP request bodies in bytes',
  labelNames: ['method', 'route'],
  buckets: sizeBuckets,
  registers: [register],
});

export const httpResponseSize = new promClient.Histogram({
  name: 'http_response_size_bytes',
  help: 'Size of HTTP responses in bytes',
  labelNames: ['method', 'route'],
  buckets: sizeBuckets,
  registers: [register],
});

export const httpInFlight = new promClient.Gauge({
  name: 'http_requests_in_flight',
  help: 'HTTP requests currently being served',
  registers: [register],
});

export const cacheOperations = new promClient.Counter({
  name: 'cache_operations_total',
  help: 'Cache lookups by layer and result',
  labelNames: ['layer', 'result'],
  registers: [register],
});

export const dbQueryDuration = new promClient.Histogram({
  name: 'db_query_duration_seconds',
  help: 'PostgreSQL query duration in seconds',
  labelNames: ['operation', 'success'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register],
});

export const dbPoolConnections = new promClient.Gauge({
  name: 'db_pool_connections',
  help: 'PostgreSQL pool connections by state',
  labelNames: ['state'],
  registers: [register],
});

export const rateLimitRejections = new promClient.Counter({
  name: 'rate_limit_rejections_total',
  help: 'Requests rejected by a rate limiter',
  labelNames: ['limiter'],
  registers: [register],
});

export const loadShedTotal = new promClient.Counter({
  name: 'load_shed_requests_total',
  help: 'Requests rejected with 503 because the event loop was overloaded',
  registers: [register],
});

export const circuitBreakerState = new promClient.Gauge({
  name: 'circuit_breaker_state',
  help: 'Circuit breaker state (0 closed, 1 half-open, 2 open)',
  labelNames: ['breaker'],
  registers: [register],
});

export const websocketConnections = new promClient.Gauge({
  name: 'websocket_connections',
  help: 'Open WebSocket connections',
  labelNames: ['endpoint'],
  registers: [register],
});

export const graphqlOperations = new promClient.Counter({
  name: 'graphql_operations_total',
  help: 'GraphQL operations by type, name and outcome',
  labelNames: ['type', 'operation', 'success'],
  registers: [register],
});

export const authAttempts = new promClient.Counter({
  name: 'auth_attempts_total',
  help: 'Authentication attempts by method and result',
  labelNames: ['method', 'result'],
  registers: [register],
});

export const todosCreated = new promClient.Counter({
  name: 'todos_created_total',
  help: 'Todos created',
  registers: [register],
});

export const uploadsBytes = new promClient.Counter({
  name: 'uploads_bytes_total',
  help: 'Bytes accepted by the upload endpoints',
  registers: [register],
});

export const externalSinkRequests = new promClient.Counter({
  name: 'monitoring_sink_requests_total',
  help: 'Requests sent to external monitoring sinks (Loki, Tempo, CloudWatch, PagerDuty)',
  labelNames: ['sink', 'result'],
  registers: [register],
});
