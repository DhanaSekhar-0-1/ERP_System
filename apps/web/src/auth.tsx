import { QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useContext, useEffect, useMemo } from 'react';
import type { UserContext } from '@erp/shared';
import { api, signedOut } from './api';

interface Auth {
  user: UserContext | null;
  loading: boolean;
  signIn(identifier: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<Auth | null>(null);

/** Forgets the signed-out user. The context query stays, so mounted screens see the change. */
function clearSession(client: QueryClient) {
  client.setQueryData(['context'], null);
  client.removeQueries({ predicate: (query) => query.queryKey[0] !== 'context' });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['context'],
    queryFn: () => api.context().catch(() => null),
    staleTime: Infinity,
  });

  useEffect(() => {
    const reset = () => clearSession(client);
    signedOut.addEventListener('signedout', reset);
    return () => signedOut.removeEventListener('signedout', reset);
  }, [client]);

  const value = useMemo<Auth>(
    () => ({
      user: data ?? null,
      loading: isLoading,
      async signIn(identifier, password) {
        await api.login(identifier, password);
        client.setQueryData(['context'], await api.context());
      },
      async signOut() {
        await api.logout();
        clearSession(client);
      },
    }),
    [client, data, isLoading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside AuthProvider');
  return auth;
}
