// src/components/SessionProvider.tsx
// This is a client component to make `useSession` and `signIn`/`signOut` available
// to all client components within your app.
'use client';
import { SessionProvider as NextAuthSessionProvider } from 'next-auth/react';
import React from 'react';

export function SessionProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextAuthSessionProvider>
      {children}
    </NextAuthSessionProvider>
  );
}