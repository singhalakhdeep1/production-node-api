'use client';

import { createClient, type Client } from 'graphql-ws';
import { useEffect, useRef, useState } from 'react';
import { RequireAuth } from '@/components/auth';
import { apiFetch, errorMessage, getToken, WS_URL } from '@/lib/api';

const EXAMPLES: Record<string, { query: string; variables?: string }> = {
  'List todos': { query: 'query Todos($limit: Int) {\n  todos(limit: $limit) {\n    total\n    cached\n    items { id title completed user { name } }\n  }\n  todoStats { total completed open }\n}', variables: '{ "limit": 5 }' },
  'Create todo': { query: 'mutation Create($title: String!) {\n  createTodo(title: $title, description: "from GraphQL") { id title createdAt }\n}', variables: '{ "title": "GraphQL todo" }' },
  'Who am I': { query: '{ me { id email name role } }' },
};

function Console() {
  const [query, setQuery] = useState(EXAMPLES['List todos'].query);
  const [variables, setVariables] = useState(EXAMPLES['List todos'].variables ?? '');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  const [subState, setSubState] = useState<'connecting' | 'live' | 'closed'>('connecting');
  const clientRef = useRef<Client | null>(null);

  useEffect(() => {
    const client = createClient({
      url: `${WS_URL}/graphql`,
      connectionParams: () => ({ authorization: `Bearer ${getToken() ?? ''}` }),
      on: { connected: () => setSubState('live'), closed: () => setSubState('closed') },
    });
    clientRef.current = client;
    const dispose = client.subscribe<{ todoUpdated: { type: string; at: string; todo: { title: string } } }>(
      { query: 'subscription { todoUpdated { type at todo { id title completed } } }' },
      {
        next: ({ data }) => {
          if (data) setEvents((e) => [`${new Date(data.todoUpdated.at).toLocaleTimeString()} ${data.todoUpdated.type}: ${data.todoUpdated.todo.title}`, ...e].slice(0, 30));
        },
        error: (err) => setEvents((e) => [`subscription error: ${errorMessage(err)}`, ...e]),
        complete: () => setSubState('closed'),
      },
    );
    return () => {
      dispose();
      void client.dispose();
    };
  }, []);

  const run = async () => {
    setBusy(true);
    try {
      const vars = variables.trim() ? JSON.parse(variables) : undefined;
      const { data } = await apiFetch('/graphql', { body: { query, variables: vars } });
      setResult(JSON.stringify(data, null, 2));
    } catch (e) {
      setResult(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>GraphQL</h1>
      <p className="muted small">Queries and mutations go over HTTP to <code>/graphql</code>; the live feed is a <code>todoUpdated</code> subscription over graphql-ws.</p>
      <div className="grid">
        <div className="card stack">
          <div className="row">
            {Object.keys(EXAMPLES).map((k) => (
              <button key={k} className="btn ghost small" onClick={() => { setQuery(EXAMPLES[k].query); setVariables(EXAMPLES[k].variables ?? ''); }}>{k}</button>
            ))}
          </div>
          <label>Query<textarea value={query} onChange={(e) => setQuery(e.target.value)} aria-label="query" rows={9} /></label>
          <label>Variables (JSON)<textarea value={variables} onChange={(e) => setVariables(e.target.value)} aria-label="variables" style={{ minHeight: 60 }} /></label>
          <button className="btn" onClick={run} disabled={busy}>{busy ? 'Running…' : 'Run'}</button>
        </div>
        <div className="card">
          <h2>Result</h2>
          <pre data-testid="gql-result">{result || 'Run a query to see the response.'}</pre>
        </div>
      </div>
      <div className="card">
        <h2>Subscription <span className={`badge ${subState === 'live' ? 'ok' : 'warn'}`} data-testid="sub-state">{subState}</span></h2>
        <div className="feed" data-testid="sub-feed">
          {events.length === 0 ? <span className="muted">Create or update a todo (here or in another tab) to see events.</span> : events.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      </div>
    </>
  );
}

export default function GraphQLPage() {
  return <RequireAuth><Console /></RequireAuth>;
}
