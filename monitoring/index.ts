/**
 * Wires the configured monitoring sinks into the app at startup. Each sink is opt-in by env:
 *   LOKI_URL                    -> Winston logs pushed to Loki
 *   TEMPO_OTLP_URL / TEMPO_URL  -> spans exported to Tempo (OTLP/HTTP), traces readable via /api/ops/traces
 *   CLOUDWATCH_ENABLED=true     -> per-minute request metrics + logs to CloudWatch
 *   DD_TRACE_ENABLED=true       -> Datadog APM (auto-instrumentation) + DogStatsD request metrics
 *   PAGERDUTY_INTEGRATION_KEY   -> incidents for unhandled errors, latency, error rate, open breakers
 * Prometheus needs no setup: /metrics is always served.
 */
import { config } from '../src/config';
import { hooks } from '../src/observability/hooks';
import { CircuitBreakerService } from '../src/services/circuit-breaker/circuit-breaker.service';
import { addLogTransport, logger } from '../src/services/structured-logging/structured-logging.service';
import { ddTracer } from '../src/tracing/datadog-init';
import { tracer } from '../src/tracing/tracer';
import { CloudWatchLogsTransport, CloudWatchService } from './cloudwatch';
import { DatadogService } from './datadog';
import { LokiService, LokiTransport } from './loki';
import { PagerDutyService } from './pagerduty';
import { TempoService } from './tempo';

export interface Monitoring {
  loki?: LokiService;
  tempo?: TempoService;
  cloudwatch?: CloudWatchService;
  datadog?: DatadogService;
  pagerduty?: PagerDutyService;
}

export const monitoring: Monitoring = {};

/** Rolling 60s window used for the error-rate alert. */
const window: { at: number; error: boolean }[] = [];
const ERROR_RATE_THRESHOLD_PCT = Number(process.env.ERROR_RATE_ALERT_THRESHOLD_PCT ?? 10);
const ERROR_RATE_MIN_REQUESTS = Number(process.env.ERROR_RATE_ALERT_MIN_REQUESTS ?? 20);

export function initMonitoring(): Monitoring {
  const m = config.monitoring;

  if (m.lokiUrl) {
    monitoring.loki = new LokiService(m.lokiUrl);
    addLogTransport(new LokiTransport(monitoring.loki));
  }

  const otlpUrl = m.tempoOtlpUrl || (m.tempoUrl ? m.tempoUrl.replace(/:3200\b/, ':4318') : '');
  if (otlpUrl) {
    monitoring.tempo = new TempoService(otlpUrl, m.tempoUrl || otlpUrl);
    const tempo = monitoring.tempo;
    tracer.setExporter((spans) => tempo.sendSpans(spans));
  }

  if (m.cloudwatchEnabled) {
    monitoring.cloudwatch = new CloudWatchService();
    monitoring.cloudwatch.start();
    const cw = monitoring.cloudwatch;
    hooks.onRequest((s) => cw.record(s));
    addLogTransport(new CloudWatchLogsTransport(cw, m.cloudwatchLogGroup, { level: 'warn' }));
  }

  if (ddTracer) {
    monitoring.datadog = new DatadogService(ddTracer);
    const dd = monitoring.datadog;
    hooks.onRequest((s) => dd.record(s));
  }

  if (m.pagerdutyIntegrationKey) {
    monitoring.pagerduty = new PagerDutyService(m.pagerdutyApiKey, m.pagerdutyIntegrationKey);
    const pd = monitoring.pagerduty;
    const swallow = (p: Promise<unknown>) => p.catch((e) => logger.warn('PagerDuty event failed', { error: (e as Error).message }));

    hooks.onError((e) => swallow(pd.triggerErrorAlert(e.error, { route: e.route, method: e.method, correlationId: e.correlationId, traceId: e.traceId })));
    hooks.onRequest((s) => {
      if (s.durationMs > m.latencyAlertThresholdMs && !s.route.startsWith('/api/ops')) {
        swallow(pd.triggerHighLatencyAlert(s.durationMs, m.latencyAlertThresholdMs, { route: s.route, method: s.method, traceId: s.traceId }));
      }
      const now = Date.now();
      window.push({ at: now, error: s.status >= 500 });
      while (window.length && window[0].at < now - 60000) window.shift();
      const errors = window.filter((w) => w.error).length;
      const rate = (errors / window.length) * 100;
      if (window.length >= ERROR_RATE_MIN_REQUESTS && rate >= ERROR_RATE_THRESHOLD_PCT) {
        swallow(pd.triggerHighErrorRateAlert(rate, ERROR_RATE_THRESHOLD_PCT, { requests: window.length, errors }));
      }
    });
    // Infrastructure breakers (database, redis) opening is incident-worthy; sink breakers are not.
    for (const name of ['redis', 'database']) {
      CircuitBreakerService.get(name)?.on('stateChange', ({ to }: { to: string }) => {
        if (to === 'open') swallow(pd.triggerIncident({ summary: `Circuit breaker "${name}" opened`, severity: 'error', dedupKey: `breaker-${name}` }));
        if (to === 'closed') swallow(pd.resolveIncident(`breaker-${name}`));
      });
    }
  }

  logger.info('Monitoring sinks initialised', { sinks: enabledSinks() });
  return monitoring;
}

export function enabledSinks(): string[] {
  return ['prometheus', ...Object.keys(monitoring).filter((k) => monitoring[k as keyof Monitoring])];
}

export async function flushMonitoring(): Promise<void> {
  await Promise.allSettled([tracer.flush(), monitoring.cloudwatch?.flush()]);
}
