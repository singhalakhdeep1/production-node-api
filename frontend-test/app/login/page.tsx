'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useAuth } from '@/components/auth';
import { errorMessage } from '@/lib/api';

export default function LoginPage() {
  const { login, register, user } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password, name);
      router.push('/todos');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (user) {
    return <div className="card">Signed in as {user.email}. <a href="/todos">Go to todos</a></div>;
  }

  return (
    <div className="card" style={{ maxWidth: 420, margin: '40px auto' }}>
      <h1>{mode === 'login' ? 'Sign in' : 'Create account'}</h1>
      {error && <div className="alert" role="alert">{error}</div>}
      <form className="stack" onSubmit={submit}>
        {mode === 'register' && (
          <label>Name<input name="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} /></label>
        )}
        <label>Email<input name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>
          Password
          <input name="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {mode === 'register' && <span className="small">8+ characters with upper, lower, digit and symbol</span>}
        </label>
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
      <p className="small muted">
        {mode === 'login' ? 'No account? ' : 'Already registered? '}
        <a href="#" onClick={(e) => { e.preventDefault(); setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
          {mode === 'login' ? 'Create one' : 'Sign in'}
        </a>
      </p>
    </div>
  );
}
