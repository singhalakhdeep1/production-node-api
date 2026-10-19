'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from './auth';

const LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/todos', label: 'Todos' },
  { href: '/keys', label: 'API keys' },
  { href: '/graphql', label: 'GraphQL' },
  { href: '/ops', label: 'Ops' },
];

export function Nav() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  return (
    <header className="nav">
      <Link href="/" className="brand">Production API</Link>
      <nav>
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={pathname === l.href ? 'active' : ''}>{l.label}</Link>
        ))}
      </nav>
      <div className="nav-user">
        {user ? (
          <>
            <span data-testid="whoami">{user.name}{user.role === 'admin' ? ' (admin)' : ''}</span>
            <button className="btn ghost" onClick={logout}>Sign out</button>
          </>
        ) : (
          <Link href="/login" className="btn">Sign in</Link>
        )}
      </div>
    </header>
  );
}
