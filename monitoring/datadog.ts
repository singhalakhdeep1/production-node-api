// Datadog APM integration. dd-trace itself is initialised first thing at startup
// (src/tracing/datadog-init.ts) so it can auto-instrument express, pg, redis and http.
import type { Span, Tracer } from 'dd-trace';
import { config } from '../src/config';
import type { RequestSample } from '../src/observability/hooks';

type MetricType = 'count' | 'gauge' | 'histogram' | 'timing' | 'distribution';

export class DatadogService {
  constructor(readonly tracer: Tracer) {}

  startSpan(operationName: string, options: { tags?: Record<string, unknown>; childOf?: Span } = {}): Span {
    return this.tracer.startSpan(operationName, { childOf: options.childOf ?? this.tracer.scope().active() ?? undefined, tags: options.tags });
  }

  /** Runs `fn` inside a new active span, tagging errors. */
  traceAsync<T>(operationName: string, fn: (span: Span) => Promise<T>, tags: Record<string, unknown> = {}): Promise<T> {
    return this.tracer.trace(operationName, { tags }, (span) => fn(span as Span));
  }

  addTags(span: Span | null | undefined, tags: Record<string, unknown>): void {
    span?.addTags(tags);
  }

  addError(span: Span | null | undefined, error: Error): void {
    span?.addTags({ error: true, 'error.message': error.message, 'error.stack': error.stack, 'error.type': error.name });
  }

  sendMetric(metricName: string, value: number, type: MetricType = 'count', tags: Record<string, string | number> = {}): void {
    const statsd = this.tracer.dogstatsd;
    const allTags = { service: config.serviceName, env: config.env, ...tags };
    switch (type) {
      case 'count': statsd.increment(metricName, value, allTags); break;
      case 'gauge': statsd.gauge(metricName, value, allTags); break;
      case 'histogram':
      case 'timing': statsd.histogram(metricName, value, allTags); break;
      case 'distribution': statsd.distribution(metricName, value, allTags); break;
    }
  }

  incrementCounter(metricName: string, value = 1, tags: Record<string, string | number> = {}) { this.sendMetric(metricName, value, 'count', tags); }
  gauge(metricName: string, value: number, tags: Record<string, string | number> = {}) { this.sendMetric(metricName, value, 'gauge', tags); }
  histogram(metricName: string, value: number, tags: Record<string, string | number> = {}) { this.sendMetric(metricName, value, 'histogram', tags); }
  timing(metricName: string, value: number, tags: Record<string, string | number> = {}) { this.sendMetric(metricName, value, 'timing', tags); }

  traceDatabaseQuery<T>(query: string, dbType: string, fn: (span: Span) => Promise<T>) {
    return this.traceAsync('database.query', fn, { 'db.type': dbType, 'db.system': dbType, 'span.type': 'sql', 'db.statement': query.slice(0, 500) });
  }

  traceExternalCall<T>(url: string, method: string, fn: (span: Span) => Promise<T>) {
    return this.traceAsync('http.client', fn, { 'http.url': url, 'http.method': method, 'span.type': 'http' });
  }

  /** Request hook: tags the auto-instrumented web span and emits DogStatsD request metrics. */
  record(sample: RequestSample): void {
    const tags = { method: sample.method, route: sample.route, status: sample.status };
    this.incrementCounter('api.http.requests', 1, tags);
    this.histogram('api.http.duration_ms', sample.durationMs, tags);
    if (sample.status >= 500) this.incrementCounter('api.http.errors', 1, tags);
  }
}
