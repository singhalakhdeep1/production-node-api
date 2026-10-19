// Grafana Loki integration: push API client, LogQL queries and a batching Winston transport.
import Transport from 'winston-transport';
import { config } from '../src/config';
import { CircuitBreakerService } from '../src/services/circuit-breaker/circuit-breaker.service';
import { sinkRequest } from './http';

type Labels = Record<string, string>;
interface LokiStream {
  stream: Labels;
  values: [string, string][];
}

const nowNs = () => `${Date.now()}000000`;

export class LokiService {
  readonly breaker = new CircuitBreakerService({ name: 'loki', failureThreshold: 3, resetTimeout: 30000 });
  pushed = 0;

  constructor(private readonly lokiUrl: string) {}

  async push(streams: LokiStream[]): Promise<void> {
    await sinkRequest('loki', this.breaker, `${this.lokiUrl}/loki/api/v1/push`, { body: { streams } });
    this.pushed += streams.reduce((n, s) => n + s.values.length, 0);
  }

  async sendLog(entry: { job?: string; level?: string; environment?: string; message: unknown }) {
    try {
      await this.push([{
        stream: { job: entry.job ?? config.serviceName, level: entry.level ?? 'info', environment: entry.environment ?? config.env },
        values: [[nowNs(), typeof entry.message === 'string' ? entry.message : JSON.stringify(entry.message)]],
      }]);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /** LogQL range query, e.g. `{job="production-api", level="error"}`. */
  async queryLogs(query: string, limit = 100, timeRange: '1h' | '6h' | '24h' | '7d' = '1h') {
    const params = new URLSearchParams({
      query,
      limit: String(limit),
      start: `${this.startTime(timeRange)}000000`,
      end: nowNs(),
      direction: 'backward',
    });
    return sinkRequest('loki', this.breaker, `${this.lokiUrl}/loki/api/v1/query_range?${params}`);
  }

  async getLabels() {
    return sinkRequest('loki', this.breaker, `${this.lokiUrl}/loki/api/v1/labels`);
  }

  async getLabelValues(label: string) {
    return sinkRequest('loki', this.breaker, `${this.lokiUrl}/loki/api/v1/label/${encodeURIComponent(label)}/values`);
  }

  private startTime(range: string): number {
    const ranges: Record<string, number> = { '1h': 3600e3, '6h': 6 * 3600e3, '24h': 24 * 3600e3, '7d': 7 * 24 * 3600e3 };
    return Date.now() - (ranges[range] ?? ranges['1h']);
  }

  createStructuredLog(level: string, message: string, context: Record<string, unknown> = {}) {
    return this.sendLog({ level, message: { level, message, timestamp: new Date().toISOString(), ...context } });
  }

  info(message: string, context?: Record<string, unknown>) { return this.createStructuredLog('info', message, context); }
  warn(message: string, context?: Record<string, unknown>) { return this.createStructuredLog('warn', message, context); }
  error(message: string, context?: Record<string, unknown>) { return this.createStructuredLog('error', message, context); }
  debug(message: string, context?: Record<string, unknown>) { return this.createStructuredLog('debug', message, context); }
}

/** Winston transport: buffers log lines and pushes them to Loki every second, grouped by level. */
export class LokiTransport extends Transport {
  private buffer: { level: string; line: string; ts: string }[] = [];
  private timer: NodeJS.Timeout;

  constructor(private readonly loki: LokiService, opts?: Transport.TransportStreamOptions) {
    super(opts);
    this.timer = setInterval(() => void this.flush(), 1000);
    this.timer.unref();
  }

  log(info: Record<string, unknown>, callback: () => void): void {
    if (this.buffer.length < 10000) {
      this.buffer.push({ level: String(info.level ?? 'info'), line: JSON.stringify(info), ts: nowNs() });
    }
    callback();
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0, this.buffer.length);
    const byLevel = new Map<string, [string, string][]>();
    for (const entry of batch) {
      const values = byLevel.get(entry.level) ?? [];
      values.push([entry.ts, entry.line]);
      byLevel.set(entry.level, values);
    }
    const streams = [...byLevel].map(([level, values]) => ({
      stream: { job: config.serviceName, level, environment: config.env, instance: config.instance },
      values,
    }));
    await this.loki.push(streams).catch(() => undefined);
  }

  close(): void {
    clearInterval(this.timer);
    void this.flush();
  }
}
