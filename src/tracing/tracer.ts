/**
 * Minimal W3C-trace-context tracer.
 * Spans nest through AsyncLocalStorage, finished spans are batched and handed to the
 * registered exporter (monitoring/tempo.ts sends them to Tempo as OTLP/HTTP JSON).
 * With no exporter, ids are still generated so logs and responses carry a trace id.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

export type SpanKind = 'internal' | 'server' | 'client';
export type AttributeValue = string | number | boolean;

export interface FinishedSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: SpanKind;
  startTimeUnixNano: bigint;
  endTimeUnixNano: bigint;
  attributes: Record<string, AttributeValue>;
  status: { code: 'ok' | 'error' | 'unset'; message?: string };
  events: { name: string; timeUnixNano: bigint; attributes?: Record<string, AttributeValue> }[];
}

type Exporter = (spans: FinishedSpan[]) => Promise<void>;

const nowNano = () => BigInt(Date.now()) * 1_000_000n + (process.hrtime.bigint() % 1_000_000n);

export class Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  private readonly start = nowNano();
  private readonly attributes: Record<string, AttributeValue>;
  private readonly events: FinishedSpan['events'] = [];
  private ended = false;
  private statusCode: FinishedSpan['status'] = { code: 'unset' };

  constructor(
    private readonly owner: Tracer,
    readonly name: string,
    readonly kind: SpanKind,
    attributes: Record<string, AttributeValue>,
    parent?: { traceId: string; spanId: string },
  ) {
    this.traceId = parent?.traceId ?? randomBytes(16).toString('hex');
    this.spanId = randomBytes(8).toString('hex');
    this.parentSpanId = parent?.spanId;
    this.attributes = { ...attributes };
  }

  setAttribute(key: string, value: AttributeValue | undefined | null): this {
    if (value !== undefined && value !== null) this.attributes[key] = value;
    return this;
  }

  addEvent(name: string, attributes?: Record<string, AttributeValue>): this {
    this.events.push({ name, timeUnixNano: nowNano(), attributes });
    return this;
  }

  setStatus(code: 'ok' | 'error', message?: string): this {
    this.statusCode = { code, message };
    return this;
  }

  end(error?: unknown): void {
    if (this.ended) return;
    this.ended = true;
    if (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus('error', message);
      this.addEvent('exception', { 'exception.message': message });
    }
    this.owner.record({
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      kind: this.kind,
      startTimeUnixNano: this.start,
      endTimeUnixNano: nowNano(),
      attributes: this.attributes,
      status: this.statusCode,
      events: this.events,
    });
  }

  /** W3C traceparent header value for this span. */
  traceparent(): string {
    return `00-${this.traceId}-${this.spanId}-01`;
  }
}

export class Tracer {
  private storage = new AsyncLocalStorage<Span>();
  private buffer: FinishedSpan[] = [];
  private exporter: Exporter | null = null;
  private timer: NodeJS.Timeout | null = null;
  exported = 0;
  dropped = 0;

  setExporter(exporter: Exporter, flushIntervalMs = 5000): void {
    this.exporter = exporter;
    this.timer = setInterval(() => void this.flush(), flushIntervalMs);
    this.timer.unref();
  }

  get enabled(): boolean {
    return this.exporter !== null;
  }

  static parseTraceparent(header: string | undefined): { traceId: string; spanId: string } | undefined {
    const match = /^[\da-f]{2}-([\da-f]{32})-([\da-f]{16})-[\da-f]{2}$/i.exec(header?.trim() ?? '');
    return match ? { traceId: match[1].toLowerCase(), spanId: match[2].toLowerCase() } : undefined;
  }

  currentSpan(): Span | undefined {
    return this.storage.getStore();
  }

  startSpan(
    name: string,
    attributes: Record<string, AttributeValue> = {},
    options: { kind?: SpanKind; parent?: { traceId: string; spanId: string } } = {},
  ): Span {
    const parent = options.parent ?? this.currentSpan();
    return new Span(this, name, options.kind ?? 'internal', attributes, parent);
  }

  withSpan<T>(span: Span, fn: () => T): T {
    return this.storage.run(span, fn);
  }

  /** Starts a child span, runs `fn` inside it and ends it with the outcome. */
  async trace<T>(name: string, attributes: Record<string, AttributeValue>, fn: (span: Span) => Promise<T>): Promise<T> {
    const span = this.startSpan(name, attributes);
    try {
      const result = await this.withSpan(span, () => fn(span));
      span.end();
      return result;
    } catch (error) {
      span.end(error);
      throw error;
    }
  }

  record(span: FinishedSpan): void {
    if (!this.exporter) return;
    if (this.buffer.length >= 5000) {
      this.dropped++;
      return;
    }
    this.buffer.push(span);
    if (this.buffer.length >= 200) void this.flush();
  }

  async flush(): Promise<void> {
    if (!this.exporter || this.buffer.length === 0) return;
    const batch = this.buffer.splice(0, this.buffer.length);
    try {
      await this.exporter(batch);
      this.exported += batch.length;
    } catch {
      this.dropped += batch.length;
    }
  }
}

export const tracer = new Tracer();
