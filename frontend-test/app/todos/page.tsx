'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { RequireAuth } from '@/components/auth';
import { apiFetch, errorMessage, formatBytes, getToken, openUpload, WS_URL, type Todo, type TodoPage, type Upload } from '@/lib/api';

const PAGE = 10;

function Attachments({ todo }: { todo: Todo }) {
  const [files, setFiles] = useState<Upload[]>([]);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data } = await apiFetch<{ items: Upload[] }>(`/api/uploads?todoId=${todo.id}`);
    setFiles(data.items);
  }, [todo.id]);

  useEffect(() => { void load().catch((e) => setError(errorMessage(e))); }, [load]);

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setError('');
    const fd = new FormData();
    fd.append('file', list[0]);
    fd.append('todoId', todo.id);
    try {
      await apiFetch('/api/uploads', { body: fd });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async (f: Upload) => {
    try {
      await apiFetch(`/api/uploads/${f.filename}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="small" style={{ marginTop: 6 }}>
      {error && <div className="alert">{error}</div>}
      {files.map((f) => (
        <div key={f.id} className="row">
          <a href="#" onClick={(e) => { e.preventDefault(); void openUpload(f).catch((err) => setError(errorMessage(err))); }}>{f.originalName}</a>
          <span className="muted">{formatBytes(f.size)}</span>
          <button className="btn ghost small" onClick={() => remove(f)}>remove</button>
        </div>
      ))}
      <label className="row" style={{ flexDirection: 'row' }}>
        <span>Attach:</span>
        <input ref={inputRef} type="file" data-testid={`attach-${todo.id}`} onChange={(e) => upload(e.target.files)} accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.csv,.doc,.docx" />
      </label>
    </div>
  );
}

function TodoRow({ todo, onChange }: { todo: Todo; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(todo.title);
  const [description, setDescription] = useState(todo.description ?? '');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  // Optimistic completion state so the checkbox responds immediately.
  const [completed, setCompleted] = useState(todo.completed);

  const patch = async (body: Partial<Todo>) => {
    if (body.completed !== undefined) setCompleted(body.completed);
    try {
      await apiFetch(`/api/todos/${todo.id}`, { method: 'PATCH', body });
      setEditing(false);
      onChange();
    } catch (e) {
      if (body.completed !== undefined) setCompleted(!body.completed);
      setError(errorMessage(e));
    }
  };

  const remove = async () => {
    try {
      await apiFetch(`/api/todos/${todo.id}`, { method: 'DELETE' });
      onChange();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className={`todo ${completed ? 'done' : ''}`} data-testid="todo-row">
      <input type="checkbox" checked={completed} aria-label={`complete ${todo.title}`} onChange={() => patch({ completed: !completed })} />
      <div className="body">
        {error && <div className="alert">{error}</div>}
        {editing ? (
          <div className="stack">
            <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="edit title" />
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" aria-label="edit description" />
            <div className="row">
              <button className="btn small" onClick={() => patch({ title, description: description || null })}>Save</button>
              <button className="btn ghost small" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <div className="title">{todo.title}</div>
            {todo.description && <div className="muted small">{todo.description}</div>}
            <div className="muted small">updated {new Date(todo.updatedAt).toLocaleString()}</div>
          </>
        )}
        {open && <Attachments todo={todo} />}
      </div>
      <div className="row">
        <button className="btn ghost small" onClick={() => setOpen((v) => !v)}>Files</button>
        <button className="btn ghost small" onClick={() => setEditing(true)}>Edit</button>
        <button className="btn danger small" onClick={remove}>Delete</button>
      </div>
    </div>
  );
}

function Todos() {
  const [page, setPage] = useState<TodoPage | null>(null);
  const [cacheHeader, setCacheHeader] = useState('');
  const [filter, setFilter] = useState<'all' | 'open' | 'done'>('all');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [feed, setFeed] = useState<string[]>([]);
  const [live, setLive] = useState(false);
  const [stats, setStats] = useState<{ total: number; completed: number; open: number } | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (filter !== 'all') params.set('completed', String(filter === 'done'));
    if (search.trim()) params.set('search', search.trim());
    try {
      const [{ data, headers }, s] = await Promise.all([
        apiFetch<TodoPage>(`/api/todos?${params}`),
        apiFetch<{ total: number; completed: number; open: number }>('/api/todos/stats'),
      ]);
      setPage(data);
      setStats(s.data);
      setCacheHeader(headers.get('x-cache') ?? '');
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [filter, search, offset]);

  useEffect(() => { void load(); }, [load]);

  // Live updates: the API pushes todo_created/updated/deleted for this user over /ws.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      ws = new WebSocket(`${WS_URL}/ws?token=${encodeURIComponent(getToken() ?? '')}`);
      ws.onopen = () => setLive(true);
      ws.onclose = () => {
        setLive(false);
        if (!closed) retry = setTimeout(connect, 3000);
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as { type: string; todo?: Todo; instance?: string };
        if (msg.type.startsWith('todo_') && msg.todo) {
          setFeed((f) => [`${new Date().toLocaleTimeString()} ${msg.type.replace('todo_', '')}: ${msg.todo!.title}`, ...f].slice(0, 30));
          void loadRef.current();
        } else if (msg.type === 'connected') {
          setFeed((f) => [`${new Date().toLocaleTimeString()} live updates connected (instance ${msg.instance})`, ...f].slice(0, 30));
        }
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/todos', { body: { title, description: description || undefined } });
      setTitle('');
      setDescription('');
      void load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <>
      <h1>Todos</h1>
      {error && <div className="alert" role="alert">{error}</div>}
      <div className="grid">
        <form className="card stack" onSubmit={create}>
          <h2>New todo</h2>
          <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="new title" required maxLength={200} />
          <input placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} aria-label="new description" maxLength={1000} />
          <button className="btn" type="submit">Add</button>
        </form>
        <div className="card">
          <h2>Summary</h2>
          {stats && (
            <div className="row" style={{ gap: 24 }}>
              <div><div className="stat" data-testid="stat-total">{stats.total}</div><div className="muted small">total</div></div>
              <div><div className="stat">{stats.open}</div><div className="muted small">open</div></div>
              <div><div className="stat" data-testid="stat-done">{stats.completed}</div><div className="muted small">done</div></div>
            </div>
          )}
          <p className="small muted">
            Live updates: <span className={`badge ${live ? 'ok' : 'bad'}`} data-testid="live">{live ? 'connected' : 'offline'}</span>
          </p>
        </div>
      </div>

      <div className="card">
        <div className="row">
          <select value={filter} onChange={(e) => { setFilter(e.target.value as typeof filter); setOffset(0); }} aria-label="filter">
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="done">Done</option>
          </select>
          <input placeholder="Search" value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} aria-label="search" />
          <span className="spacer" />
          {cacheHeader && <span className="badge" title="Redis/in-memory cache result for this list">cache {cacheHeader}</span>}
        </div>
        {page?.items.length === 0 && <p className="muted">No todos yet.</p>}
        {page?.items.map((t) => <TodoRow key={`${t.id}-${t.updatedAt}`} todo={t} onChange={load} />)}
        {page && page.total > PAGE && (
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn ghost small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
            <span className="small muted">{offset + 1}–{Math.min(offset + PAGE, page.total)} of {page.total}</span>
            <button className="btn ghost small" disabled={offset + PAGE >= page.total} onClick={() => setOffset(offset + PAGE)}>Next</button>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Activity</h2>
        <div className="feed" data-testid="feed">{feed.map((f, i) => <div key={i}>{f}</div>)}</div>
      </div>
    </>
  );
}

export default function TodosPage() {
  return <RequireAuth><Todos /></RequireAuth>;
}
