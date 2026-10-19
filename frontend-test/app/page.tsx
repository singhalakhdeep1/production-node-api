'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth';
import { API_URL, apiFetch, errorMessage } from '@/lib/api';

interface Health {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  version: string;
  instance: string;
  timestamp: string;
  checks: Record<string, { status: 'pass' | 'warn' | 'fail'; message: string; duration: number; critical: boolean }>;
}

interface MetricSample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

function parseMetrics(text: string): MetricSample[] {
  const out: MetricSample[] = [];
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const m = /^([a-zA-Z_:][\w:]*)(\{([^}]*)\})?\s+(\S+)/.exec(line);
    if (!m) continue;
    const labels: Record<string, string> = {};
    for (const pair of (m[3] ?? '').matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g)) labels[pair[1]] = pair[2];
    out.push({ name: m[1], labels, value: Number(m[4]) });
  }
  return out;
}

const sum = (samples: MetricSample[], name: string, filter: (l: Record<string, string>) => boolean = () => true) =>
  samples.filter((s) => s.name === name && filter(s.labels)).reduce((n, s) => n + s.value, 0);

const statusBadge = (s: string) => (s === 'pass' || s === 'healthy' ? 'ok' : s === 'warn' || s === 'degraded' ? 'warn' : 'bad');

export default function Dashboard() {
  const { user } = useAuth();
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState('');
  const [metrics, setMetrics] = useState<MetricSample[]>([]);
  const [rawMetrics, setRawMetrics] = useState('');
  const [showRaw, setShowRaw] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/health`);
      setHealth(await res.json());
      setHealthError('');
    } catch (error) {
      setHealthError(`API unreachable at ${API_URL}: ${errorMessage(error)}`);
      setHealth(null);
    }
    try {
      const { data } = await apiFetch<string>('/metrics', { auth: false });
      setRawMetrics(data);
      setMetrics(parseMetrics(data));
    } catch {
      /* metrics may be blocked by a proxy */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const requests = sum(metrics, 'http_requests_total');
  const errors5xx = sum(metrics, 'http_requests_total', (l) => l.status?.startsWith('5'));
  const durationSum = sum(metrics, 'http_request_duration_seconds_sum');
  const durationCount = sum(metrics, 'http_request_duration_seconds_count');
  const cacheHits = sum(metrics, 'cache_operations_total', (l) => l.result === 'hit');
  const cacheLookups = sum(metrics, 'cache_operations_total', (l) => l.layer === 'memory');
  const rss = sum(metrics, 'process_resident_memory_bytes');
  const lag = sum(metrics, 'nodejs_eventloop_lag_seconds');
  const ws = sum(metrics, 'websocket_connections');

  return (
    <>
      <h1>Dashboard</h1>
      {healthError && <div className="alert">{healthError}</div>}
      {!user && <div className="card small">Health and metrics are public. <a href="/login">Sign in</a> to manage todos, keys and ops.</div>}

      <div className="grid">
        <div className="card">
          <h2>Health</h2>
          {health ? (
            <>
              <div className="row">
                <span className={`badge ${statusBadge(health.status)}`} data-testid="health-status">{health.status}</span>
                <span className="muted small">v{health.version} · instance {health.instance}</span>
              </div>
              <p className="small muted">Uptime {Math.floor(health.uptime / 60)} min · checked {new Date(health.timestamp).toLocaleTimeString()}</p>
              <table>
                <tbody>
                  {Object.entries(health.checks).map(([name, c]) => (
                    <tr key={name}>
                      <td>{name}{c.critical ? '' : <span className="muted small"> (non-critical)</span>}</td>
                      <td><span className={`badge ${statusBadge(c.status)}`}>{c.status}</span></td>
                      <td className="small muted">{c.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : <p className="muted">Checking…</p>}
        </div>

        <div className="card">
          <h2>Traffic (this instance)</h2>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div><div className="stat" data-testid="requests-total">{requests}</div><div className="muted small">requests</div></div>
            <div><div className="stat">{errors5xx}</div><div className="muted small">5xx errors</div></div>
            <div><div className="stat">{durationCount ? ((durationSum / durationCount) * 1000).toFixed(1) : '0'} ms</div><div className="muted small">mean latency</div></div>
            <div><div className="stat">{cacheLookups ? Math.round((cacheHits / cacheLookups) * 100) : 0}%</div><div className="muted small">cache hit ratio</div></div>
            <div><div className="stat">{(rss / 1048576).toFixed(0)} MB</div><div className="muted small">RSS</div></div>
            <div><div className="stat">{(lag * 1000).toFixed(1)} ms</div><div className="muted small">event loop lag</div></div>
            <div><div className="stat">{ws}</div><div className="muted small">WebSocket connections</div></div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="row">
          <h2 style={{ margin: 0 }}>Prometheus metrics</h2>
          <span className="spacer" />
          <button className="btn ghost small" onClick={() => setShowRaw((v) => !v)}>{showRaw ? 'Hide' : 'Show'} raw /metrics</button>
        </div>
        <p className="small muted">Scraped by Prometheus from <code>{API_URL}/metrics</code>; dashboards in Grafana (see README).</p>
        {showRaw && <pre data-testid="raw-metrics">{rawMetrics}</pre>}
      </div>

      <div className="card small">
        <h2>Endpoints</h2>
        <ul>
          <li>REST docs: <a href={`${API_URL}/api/docs`} target="_blank" rel="noreferrer">{API_URL}/api/docs</a></li>
          <li>GraphQL: <code>{API_URL}/graphql</code> (subscriptions over WebSocket on the same path)</li>
          <li>WebSocket: <code>{API_URL.replace(/^http/, 'ws')}/ws?token=…</code></li>
          <li>Probes: <code>/api/health/live</code>, <code>/api/health/ready</code></li>
        </ul>
      </div>
    </>
  );
}
