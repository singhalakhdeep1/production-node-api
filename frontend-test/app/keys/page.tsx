'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { RequireAuth, useAuth } from '@/components/auth';
import { API_URL, apiFetch, errorMessage, type ApiKey } from '@/lib/api';

const SCOPES = ['read', 'write', 'upload', 'admin'] as const;

function Keys() {
  const { user } = useAuth();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['read']);
  const [days, setDays] = useState(90);
  const [created, setCreated] = useState<ApiKey | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await apiFetch<{ items: ApiKey[] }>('/api/keys');
      setKeys(data.items);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const { data } = await apiFetch<ApiKey>('/api/keys', { body: { name, scopes, expiresInDays: days } });
      setCreated(data);
      setName('');
      void load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const revoke = async (id: string) => {
    try {
      await apiFetch(`/api/keys/${id}`, { method: 'DELETE' });
      void load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const toggle = (s: string) => setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  return (
    <>
      <h1>API keys</h1>
      <p className="muted small">Machine clients send a key in the <code>X-API-Key</code> header. Keys only grant their scopes; only the SHA-256 hash is stored.</p>
      {error && <div className="alert" role="alert">{error}</div>}
      {created?.key && (
        <div className="notice" data-testid="new-key">
          New key <strong>{created.name}</strong> (copy it now, it is not shown again):<br />
          <code>{created.key}</code>
          <pre style={{ marginTop: 8 }}>{`curl -H "X-API-Key: ${created.key}" ${API_URL}/api/todos`}</pre>
        </div>
      )}
      <form className="card stack" onSubmit={create}>
        <h2>Create key</h2>
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} aria-label="key name" /></label>
        <div className="row">
          {SCOPES.filter((s) => s !== 'admin' || user?.role === 'admin').map((s) => (
            <label key={s} className="row" style={{ flexDirection: 'row' }}>
              <input type="checkbox" checked={scopes.includes(s)} onChange={() => toggle(s)} aria-label={`scope ${s}`} /> {s}
            </label>
          ))}
        </div>
        <label>Expires in (days)<input type="number" min={1} max={3650} value={days} onChange={(e) => setDays(Number(e.target.value))} /></label>
        <button className="btn" type="submit" disabled={scopes.length === 0}>Create key</button>
      </form>
      <div className="card">
        <table>
          <thead><tr><th>Name</th><th>Prefix</th><th>Scopes</th><th>Status</th><th>Last used</th><th>Expires</th><th /></tr></thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} data-testid="key-row">
                <td>{k.name}</td>
                <td><code>{k.keyPrefix}…</code></td>
                <td>{k.scopes.join(', ')}</td>
                <td><span className={`badge ${k.isActive ? 'ok' : 'bad'}`}>{k.isActive ? 'active' : 'revoked'}</span></td>
                <td className="small">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'never'}</td>
                <td className="small">{k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : '—'}</td>
                <td>{k.isActive && <button className="btn danger small" onClick={() => revoke(k.id)}>Revoke</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {keys.length === 0 && <p className="muted">No keys yet.</p>}
      </div>
    </>
  );
}

export default function KeysPage() {
  return <RequireAuth><Keys /></RequireAuth>;
}
