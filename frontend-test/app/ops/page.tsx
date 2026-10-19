'use client';

import { useCallback, useEffect, useState } from 'react';
import { RequireAuth, useAuth } from '@/components/auth';
import { apiFetch, errorMessage } from '@/lib/api';

interface Breaker {
  name: string;
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  failureThreshold: number;
  lastFailureAt: string | null;
  totals: { success: number; failure: number; rejected: number };
}

interface Incident {
  dedupKey: string;
  summary: string;
  severity: string;
  status: string;
  lastEventAt: string;
  count: number;
}

interface Status {
  service: string;
  version: string;
  environment: string;
  instance: string;
  node: string;
  uptimeSeconds: number;
  memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number };
  eventLoopLagMs: number;
  database: { totalConnections: number; idle: number; waiting: number; max: number };
  cache: { enabled: boolean; connected: boolean; memoryEntries: number; l1Hits: number; l2Hits: number; misses: number; invalidations: number };
  eventBus: string;
  circuitBreakers: Breaker[];
  rateLimiting: { ip: { windowMs: number; max: number }; tokenBucket: { activeBuckets: number; bucketCapacity: number; refillRate: number; rejectedTotal: number } };
  websockets: { users: number; connections: number };
  graphql: { subscriptionSockets: number };
  monitoring: {
    sinks: string[];
    tracing: { exporting: boolean; exportedSpans: number; droppedSpans: number };
    pagerduty: { incidents: Incident[] } | null;
  };
}

const stateBadge = (s: string) => (s === 'closed' ? 'ok' : s === 'half-open' ? 'warn' : 'bad');

function Ops() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [summary, setSummary] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await apiFetch<Status>('/api/ops/status');
      setStatus(data);
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (path: string, body?: unknown, done?: string) => {
    try {
      await apiFetch(path, { method: 'POST', body: body ?? {} });
      setMessage(done ?? 'Done');
      void load();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  if (!status) return <>{error ? <div className="alert">{error}</div> : <p className="muted">Loading…</p>}</>;

  return (
    <>
      <h1>Operations</h1>
      {error && <div className="alert" role="alert">{error}</div>}
      {message && <div className="notice">{message}</div>}
      {!isAdmin && <div className="card small">Read-only view. Actions need an admin account.</div>}

      <div className="grid">
        <div className="card small">
          <h2>Runtime</h2>
          <div>{status.service} v{status.version} ({status.environment})</div>
          <div>Instance <strong data-testid="ops-instance">{status.instance}</strong> · Node {status.node}</div>
          <div>Uptime {Math.floor(status.uptimeSeconds / 60)} min</div>
          <div>RSS {status.memory.rssMb} MB · heap {status.memory.heapUsedMb}/{status.memory.heapTotalMb} MB</div>
          <div>Event loop lag {status.eventLoopLagMs} ms</div>
          <div>DB pool {status.database.totalConnections}/{status.database.max} (idle {status.database.idle}, waiting {status.database.waiting})</div>
        </div>
        <div className="card small">
          <h2>Cache</h2>
          <div>Redis: <span className={`badge ${status.cache.connected ? 'ok' : status.cache.enabled ? 'bad' : 'warn'}`}>{status.cache.connected ? 'connected' : status.cache.enabled ? 'down' : 'not configured'}</span></div>
          <div>L1 hits {status.cache.l1Hits} · L2 hits {status.cache.l2Hits} · misses {status.cache.misses}</div>
          <div>Memory entries {status.cache.memoryEntries} · tag invalidations {status.cache.invalidations}</div>
          <div>Event bus: {status.eventBus}</div>
          {isAdmin && <button className="btn ghost small" style={{ marginTop: 8 }} onClick={() => act('/api/ops/cache/flush', {}, 'Cache flushed')}>Flush cache</button>}
        </div>
        <div className="card small">
          <h2>Traffic control</h2>
          <div>IP limit: {status.rateLimiting.ip.max} req / {status.rateLimiting.ip.windowMs / 60000} min</div>
          <div>Token bucket: {status.rateLimiting.tokenBucket.bucketCapacity} burst, {status.rateLimiting.tokenBucket.refillRate}/s · {status.rateLimiting.tokenBucket.activeBuckets} buckets · {status.rateLimiting.tokenBucket.rejectedTotal} rejected</div>
          <div>WebSockets: {status.websockets.connections} on /ws ({status.websockets.users} users), {status.graphql.subscriptionSockets} on /graphql</div>
          {isAdmin && <button className="btn ghost small" style={{ marginTop: 8 }} onClick={() => act('/api/ops/load-shedding', { durationMs: 10000 }, 'Shedding load for 10s: API calls get 503 + Retry-After')}>Simulate overload (10s)</button>}
        </div>
      </div>

      <div className="card">
        <h2>Circuit breakers</h2>
        <table>
          <thead><tr><th>Breaker</th><th>State</th><th>Failures</th><th>OK / failed / rejected</th><th>Last failure</th>{isAdmin && <th />}</tr></thead>
          <tbody>
            {status.circuitBreakers.map((b) => (
              <tr key={b.name} data-testid={`breaker-${b.name}`}>
                <td>{b.name}</td>
                <td><span className={`badge ${stateBadge(b.state)}`}>{b.state}</span></td>
                <td>{b.failureCount}/{b.failureThreshold}</td>
                <td className="small">{b.totals.success} / {b.totals.failure} / {b.totals.rejected}</td>
                <td className="small">{b.lastFailureAt ? new Date(b.lastFailureAt).toLocaleTimeString() : '—'}</td>
                {isAdmin && (
                  <td className="row">
                    <button className="btn ghost small" onClick={() => act(`/api/ops/circuit-breakers/${b.name}/trip`, {}, `${b.name} tripped`)}>Trip</button>
                    <button className="btn ghost small" onClick={() => act(`/api/ops/circuit-breakers/${b.name}/reset`, {}, `${b.name} reset`)}>Reset</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Monitoring sinks</h2>
        <div className="row">{status.monitoring.sinks.map((s) => <span key={s} className="badge ok">{s}</span>)}</div>
        <p className="small muted">
          Tracing: {status.monitoring.tracing.exporting ? `exporting to Tempo (${status.monitoring.tracing.exportedSpans} spans sent, ${status.monitoring.tracing.droppedSpans} dropped)` : 'no exporter configured (trace ids still returned in X-Trace-ID)'}.
          Sinks are enabled per environment variable; see the README.
        </p>
      </div>

      <div className="card">
        <h2>Incidents (PagerDuty)</h2>
        {status.monitoring.pagerduty ? (
          <>
            {isAdmin && (
              <div className="row" style={{ marginBottom: 10 }}>
                <input placeholder="Incident summary" value={summary} onChange={(e) => setSummary(e.target.value)} aria-label="incident summary" />
                <button className="btn small" disabled={!summary.trim()} onClick={() => { void act('/api/ops/incidents', { summary, severity: 'warning' }, 'Incident triggered'); setSummary(''); }}>Trigger</button>
                <button className="btn ghost small" onClick={() => act('/api/ops/simulate-error', {}, '')}>Simulate 500</button>
              </div>
            )}
            <table>
              <thead><tr><th>Summary</th><th>Severity</th><th>Status</th><th>Count</th><th>Last event</th>{isAdmin && <th />}</tr></thead>
              <tbody>
                {status.monitoring.pagerduty.incidents.map((i) => (
                  <tr key={i.dedupKey}>
                    <td>{i.summary}</td>
                    <td>{i.severity}</td>
                    <td><span className={`badge ${i.status === 'resolved' ? 'ok' : i.status === 'acknowledged' ? 'warn' : 'bad'}`}>{i.status}</span></td>
                    <td>{i.count}</td>
                    <td className="small">{new Date(i.lastEventAt).toLocaleTimeString()}</td>
                    {isAdmin && (
                      <td className="row">
                        {i.status === 'triggered' && <button className="btn ghost small" onClick={() => act(`/api/ops/incidents/${encodeURIComponent(i.dedupKey)}/acknowledge`, {}, 'Acknowledged')}>Ack</button>}
                        {i.status !== 'resolved' && <button className="btn ghost small" onClick={() => act(`/api/ops/incidents/${encodeURIComponent(i.dedupKey)}/resolve`, {}, 'Resolved')}>Resolve</button>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p className="muted small">PagerDuty is not configured on this instance (set PAGERDUTY_INTEGRATION_KEY).</p>
        )}
      </div>
    </>
  );
}

export default function OpsPage() {
  return <RequireAuth><Ops /></RequireAuth>;
}
