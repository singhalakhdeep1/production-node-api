export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5000').replace(/\/$/, '');
export const WS_URL = API_URL.replace(/^http/, 'ws');

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  createdAt: string;
}

export interface Todo {
  id: string;
  title: string;
  description: string | null;
  completed: boolean;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TodoPage {
  items: Todo[];
  total: number;
  limit: number;
  offset: number;
  cached: boolean;
}

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  isActive: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  key?: string;
}

export interface Upload {
  id: string;
  filename: string;
  originalName: string;
  mimetype: string;
  size: number;
  todoId: string | null;
  url: string;
  createdAt: string;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown) {
    super(message);
  }
}

const TOKEN_KEY = 'pna.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

export interface ApiResult<T> {
  data: T;
  headers: Headers;
  status: number;
}

export async function apiFetch<T = unknown>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token && init.auth !== false) headers.authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (init.body instanceof FormData) body = init.body;
  else if (init.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  const res = await fetch(`${API_URL}${path}`, { method: init.method ?? (body ? 'POST' : 'GET'), headers, body });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON (metrics) */
  }
  if (!res.ok) {
    const err = data as { error?: string; details?: unknown } | null;
    throw new ApiError(res.status, err?.error ?? `HTTP ${res.status}`, err?.details);
  }
  return { data: data as T, headers: res.headers, status: res.status };
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError && Array.isArray(error.details)) {
    return `${error.message}: ${(error.details as { message: string }[]).map((d) => d.message).join('; ')}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

/** Fetches an owner-only upload with the bearer token and opens it as a blob URL. */
export async function openUpload(upload: Upload): Promise<void> {
  const res = await fetch(`${API_URL}${upload.url}`, { headers: { authorization: `Bearer ${getToken() ?? ''}` } });
  if (!res.ok) throw new ApiError(res.status, 'Download failed');
  const url = URL.createObjectURL(await res.blob());
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
