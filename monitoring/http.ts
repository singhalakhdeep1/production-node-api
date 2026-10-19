import { externalSinkRequests } from '../src/metrics';
import { CircuitBreakerService } from '../src/services/circuit-breaker/circuit-breaker.service';

/** JSON-over-HTTP call to a monitoring backend, guarded by that sink's circuit breaker. */
export async function sinkRequest<T = unknown>(
  sink: string,
  breaker: CircuitBreakerService,
  url: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<T> {
  try {
    const result = await breaker.execute(async () => {
      const res = await fetch(url, {
        method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
        headers: { 'Content-Type': 'application/json', ...init.headers },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(init.timeoutMs ?? 5000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${sink} responded ${res.status}: ${text.slice(0, 200)}`);
      return (text ? JSON.parse(text) : {}) as T;
    });
    externalSinkRequests.inc({ sink, result: 'success' });
    return result;
  } catch (error) {
    externalSinkRequests.inc({ sink, result: 'failure' });
    throw error;
  }
}
