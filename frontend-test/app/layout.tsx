import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/components/auth';
import { Nav } from '@/components/nav';
import './globals.css';

export const metadata: Metadata = {
  title: 'Production API Dashboard',
  description: 'Todos, API keys, GraphQL, health, metrics and ops for the Production Node API',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <Nav />
          <main className="container">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
