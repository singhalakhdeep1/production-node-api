/**
 * Circuit Breaker Service (HLD/LLD #3)
 * closed -> open after `failureThreshold` consecutive failures; open -> half-open after
 * `resetTimeout`; half-open -> closed after `halfOpenSuccesses` successes, or back to open on
 * the first failure. Every breaker is registered so /api/ops/status and /metrics can show it.
 */
import { EventEmitter } from 'node:events';

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  name?: string;
  failureThreshold?: number;
  resetTimeout?: number;
  halfOpenSuccesses?: number;
}

export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`Circuit breaker "${name}" is open`);
    this.name = 'CircuitOpenError';
  }
}

const registry = new Map<string, CircuitBreakerService>();

export class CircuitBreakerService extends EventEmitter {
  readonly name: string;
  readonly failureThreshold: number;
  readonly resetTimeout: number;
  readonly halfOpenSuccesses: number;
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | null = null;
  private totals = { success: 0, failure: 0, rejected: 0 };

  constructor(options: CircuitBreakerOptions = {}) {
    super();
    this.name = options.name ?? `breaker-${registry.size + 1}`;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeout = options.resetTimeout ?? 60000;
    this.halfOpenSuccesses = options.halfOpenSuccesses ?? 2;
    registry.set(this.name, this);
  }

  static all(): CircuitBreakerService[] {
    return [...registry.values()];
  }

  static get(name: string): CircuitBreakerService | undefined {
    return registry.get(name);
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (this.shouldAttemptReset()) {
        this.transition('half-open');
      } else {
        this.totals.rejected++;
        throw new CircuitOpenError(this.name);
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.totals.success++;
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= this.halfOpenSuccesses) this.reset();
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.totals.failure++;
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.state === 'half-open' || this.failureCount >= this.failureThreshold) this.trip();
  }

  private transition(next: CircuitState): void {
    if (this.state === next) return;
    const previous = this.state;
    this.state = next;
    this.emit('stateChange', { name: this.name, from: previous, to: next });
  }

  trip(): void {
    this.successCount = 0;
    this.lastFailureTime = Date.now();
    this.transition('open');
  }

  reset(): void {
    this.failureCount = 0;
    this.successCount = 0;
    this.transition('closed');
  }

  private shouldAttemptReset(): boolean {
    return this.lastFailureTime !== null && Date.now() - this.lastFailureTime >= this.resetTimeout;
  }

  getState(): CircuitState {
    return this.state;
  }

  getFailureCount(): number {
    return this.failureCount;
  }

  manualReset(): void {
    this.reset();
  }

  manualTrip(): void {
    this.trip();
  }

  snapshot() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      failureThreshold: this.failureThreshold,
      resetTimeoutMs: this.resetTimeout,
      lastFailureAt: this.lastFailureTime ? new Date(this.lastFailureTime).toISOString() : null,
      totals: { ...this.totals },
    };
  }
}
