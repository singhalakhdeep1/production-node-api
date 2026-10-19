// Tempo tracing integration: exports the API's spans as OTLP/HTTP JSON and reads traces back.
import { config } from '../src/config';
import { CircuitBreakerService } from '../src/services/circuit-breaker/circuit-breaker.service';
import type { AttributeValue, FinishedSpan } from '../src/tracing/tracer';
import { sinkRequest } from './http';

const KIND = { internal: 1, server: 2, client: 3 } as const;
const STATUS = { unset: 0, ok: 1, error: 2 } as const;

const attr = (key: string, value: AttributeValue) => ({
  key,
  value: typeof value === 'boolean'
    ? { boolValue: value }
    : typeof value === 'number'
      ? Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value }
      : { stringValue: value },
});

export class TempoService {
  readonly breaker = new CircuitBreakerService({ name: 'tempo', failureThreshold: 3, resetTimeout: 30000 });

  /**
   * @param otlpUrl  Tempo's OTLP/HTTP receiver, e.g. http://tempo:4318
   * @param queryUrl Tempo's HTTP API, e.g. http://tempo:3200
   */
  constructor(private readonly otlpUrl: string, private readonly queryUrl: string) {}

  toOtlp(spans: FinishedSpan[]) {
    return {
      resourceSpans: [{
        resource: {
          attributes: [
            attr('service.name', config.serviceName),
            attr('service.version', config.version),
            attr('service.instance.id', config.instance),
            attr('deployment.environment', config.env),
          ],
        },
        scopeSpans: [{
          scope: { name: 'production-node-api', version: config.version },
          spans: spans.map((s) => ({
            traceId: s.traceId,
            spanId: s.spanId,
            parentSpanId: s.parentSpanId ?? '',
            name: s.name,
            kind: KIND[s.kind],
            startTimeUnixNano: s.startTimeUnixNano.toString(),
            endTimeUnixNano: s.endTimeUnixNano.toString(),
            attributes: Object.entries(s.attributes).map(([k, v]) => attr(k, v)),
            events: s.events.map((e) => ({
              name: e.name,
              timeUnixNano: e.timeUnixNano.toString(),
              attributes: Object.entries(e.attributes ?? {}).map(([k, v]) => attr(k, v)),
            })),
            status: { code: STATUS[s.status.code], message: s.status.message ?? '' },
          })),
        }],
      }],
    };
  }

  async sendSpans(spans: FinishedSpan[]): Promise<void> {
    if (spans.length === 0) return;
    await sinkRequest('tempo', this.breaker, `${this.otlpUrl}/v1/traces`, { body: this.toOtlp(spans) });
  }

  async getTrace(traceId: string) {
    if (!/^[\da-f]{32}$/i.test(traceId)) throw new Error('traceId must be 32 hex characters');
    return sinkRequest('tempo', this.breaker, `${this.queryUrl}/api/traces/${traceId}`);
  }

  /** Tempo search, e.g. { tags: 'service.name=production-api', minDuration: '100ms', limit: 20 }. */
  async searchTraces(query: Record<string, string | number>) {
    const params = new URLSearchParams(Object.entries(query).map(([k, v]): [string, string] => [k, String(v)]));
    return sinkRequest('tempo', this.breaker, `${this.queryUrl}/api/search?${params}`);
  }
}
