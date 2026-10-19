// PagerDuty integration: Events API v2 (trigger/acknowledge/resolve) and REST API reads.
import { config } from '../src/config';
import { CircuitBreakerService } from '../src/services/circuit-breaker/circuit-breaker.service';
import { sinkRequest } from './http';

export type Severity = 'critical' | 'error' | 'warning' | 'info';

export interface IncidentInput {
  summary: string;
  severity?: Severity;
  source?: string;
  dedupKey: string;
  details?: Record<string, unknown>;
}

export interface IncidentRecord {
  dedupKey: string;
  summary: string;
  severity: Severity;
  status: 'triggered' | 'acknowledged' | 'resolved';
  lastEventAt: string;
  count: number;
}

export class PagerDutyService {
  readonly breaker = new CircuitBreakerService({ name: 'pagerduty', failureThreshold: 3, resetTimeout: 60000 });
  private incidents = new Map<string, IncidentRecord>();
  private lastSent = new Map<string, number>();

  constructor(
    private readonly apiKey: string,
    private readonly integrationKey: string,
    private readonly eventsUrl = config.monitoring.pagerdutyEventsUrl,
    private readonly baseUrl = config.monitoring.pagerdutyApiUrl,
    private readonly throttleMs = 5 * 60 * 1000,
  ) {}

  private sendEvent(body: Record<string, unknown>) {
    return sinkRequest<{ status: string; dedup_key: string; message: string }>('pagerduty', this.breaker, this.eventsUrl, {
      body: { routing_key: this.integrationKey, ...body },
    });
  }

  /** Triggers (or re-triggers) an incident. Repeats of the same dedup key are throttled. */
  async triggerIncident(incident: IncidentInput, { force = false } = {}) {
    const existing = this.incidents.get(incident.dedupKey);
    const last = this.lastSent.get(incident.dedupKey) ?? 0;
    if (!force && existing?.status === 'triggered' && Date.now() - last < this.throttleMs) {
      existing.count++;
      return { success: true, throttled: true, dedupKey: incident.dedupKey };
    }
    const severity = incident.severity ?? 'critical';
    const data = await this.sendEvent({
      event_action: 'trigger',
      dedup_key: incident.dedupKey,
      payload: {
        summary: incident.summary.slice(0, 1024),
        severity,
        source: incident.source ?? `${config.serviceName}@${config.instance}`,
        component: config.serviceName,
        timestamp: new Date().toISOString(),
        custom_details: incident.details ?? {},
      },
    });
    this.lastSent.set(incident.dedupKey, Date.now());
    this.incidents.set(incident.dedupKey, {
      dedupKey: incident.dedupKey,
      summary: incident.summary,
      severity,
      status: 'triggered',
      lastEventAt: new Date().toISOString(),
      count: (existing?.count ?? 0) + 1,
    });
    return { success: true, throttled: false, dedupKey: data.dedup_key ?? incident.dedupKey };
  }

  private async transition(dedupKey: string, action: 'acknowledge' | 'resolve') {
    const data = await this.sendEvent({ event_action: action, dedup_key: dedupKey });
    const record = this.incidents.get(dedupKey);
    if (record) {
      record.status = action === 'acknowledge' ? 'acknowledged' : 'resolved';
      record.lastEventAt = new Date().toISOString();
    }
    if (action === 'resolve') this.lastSent.delete(dedupKey);
    return { success: true, data };
  }

  acknowledgeIncident(dedupKey: string) { return this.transition(dedupKey, 'acknowledge'); }
  resolveIncident(dedupKey: string) { return this.transition(dedupKey, 'resolve'); }

  private restHeaders() {
    return { Accept: 'application/vnd.pagerduty+json;version=2', Authorization: `Token token=${this.apiKey}` };
  }

  async getIncidents(serviceId: string, status = 'triggered') {
    const params = new URLSearchParams({ 'service_ids[]': serviceId, 'statuses[]': status });
    return sinkRequest('pagerduty', this.breaker, `${this.baseUrl}/incidents?${params}`, { headers: this.restHeaders() });
  }

  async createService(service: { name: string; description?: string; escalationPolicyId: string }) {
    return sinkRequest('pagerduty', this.breaker, `${this.baseUrl}/services`, {
      headers: this.restHeaders(),
      body: {
        service: {
          name: service.name,
          type: 'service',
          description: service.description ?? '',
          escalation_policy: { id: service.escalationPolicyId, type: 'escalation_policy_reference' },
        },
      },
    });
  }

  triggerErrorAlert(error: Error, context: Record<string, unknown> = {}) {
    return this.triggerIncident({
      summary: `Error in ${config.serviceName}: ${error.message}`,
      severity: 'critical',
      dedupKey: `error-${context.route ?? 'unknown'}-${error.name}`,
      details: { error: error.message, stack: error.stack, ...context },
    });
  }

  triggerHighLatencyAlert(latencyMs: number, thresholdMs: number, context: Record<string, unknown> = {}) {
    return this.triggerIncident({
      summary: `High latency on ${context.route ?? 'unknown'}: ${Math.round(latencyMs)}ms (threshold ${thresholdMs}ms)`,
      severity: 'warning',
      dedupKey: `latency-${context.route ?? 'unknown'}`,
      details: { latencyMs, thresholdMs, ...context },
    });
  }

  triggerHighErrorRateAlert(errorRatePct: number, thresholdPct: number, context: Record<string, unknown> = {}) {
    return this.triggerIncident({
      summary: `High error rate: ${errorRatePct.toFixed(1)}% (threshold ${thresholdPct}%)`,
      severity: 'critical',
      dedupKey: `error-rate-${context.scope ?? 'api'}`,
      details: { errorRatePct, thresholdPct, ...context },
    });
  }

  listIncidents(): IncidentRecord[] {
    return [...this.incidents.values()].sort((a, b) => b.lastEventAt.localeCompare(a.lastEventAt));
  }
}
