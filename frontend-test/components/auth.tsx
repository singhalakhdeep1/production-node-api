'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiFetch, getToken, setToken, type User } from '@/lib/api';

interface AuthState {
  user: User | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      setReady(true);
      return;
    }
    apiFetch<{ user: User }>('/api/auth/me')
      .then(({ data }) => setUser(data.user))
      .catch(() => setToken(null))
      .finally(() => setReady(true));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await apiFetch<{ token: string; user: User }>('/api/auth/login', { body: { email, password }, auth: false });
    setToken(data.token);
    setUser(data.user);
  }, []);

  const register = useCallback(async (email: string, password: string, name: string) => {
    const { data } = await apiFetch<{ token: string; user: User }>('/api/auth/register', { body: { email, password, name }, auth: false });
    setToken(data.token);
    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, ready, login, register, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Renders children only for signed-in users; otherwise a prompt to sign in. */
export function RequireAuth({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const { user, ready } = useAuth();
  if (!ready) return <p className="muted">Loading…</p>;
  if (!user) {
    return (
      <div className="card">
        <p>You need to sign in to use this page.</p>
        <a className="btn" href="/login">Sign in</a>
      </div>
    );
  }
  if (admin && user.role !== 'admin') {
    return <div className="card"><p>This page needs an admin account (set its email in the API&apos;s ADMIN_EMAILS).</p></div>;
  }
  return <>{children}</>;
}
