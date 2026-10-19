/**
 * Decouples the request pipeline from the optional monitoring sinks in /monitoring.
 * Sinks (CloudWatch, Datadog, PagerDuty) subscribe at startup; the pipeline just emits.
 */
export interface RequestSample {
  method: string;
  route: string;
  path: string;
  status: number;
  durationMs: number;
  userId?: string;
  traceId?: string;
  correlationId?: string;
}

export interface ErrorSample {
  error: Error;
  method: string;
  route: string;
  status: number;
  userId?: string;
  correlationId?: string;
  traceId?: string;
}

type Listener<T> = (sample: T) => void;

const requestListeners: Listener<RequestSample>[] = [];
const errorListeners: Listener<ErrorSample>[] = [];

export const hooks = {
  onRequest(listener: Listener<RequestSample>) {
    requestListeners.push(listener);
  },
  onError(listener: Listener<ErrorSample>) {
    errorListeners.push(listener);
  },
  emitRequest(sample: RequestSample) {
    for (const l of requestListeners) {
      try { l(sample); } catch { /* a sink must never break a request */ }
    }
  },
  emitError(sample: ErrorSample) {
    for (const l of errorListeners) {
      try { l(sample); } catch { /* ignore */ }
    }
  },
};
