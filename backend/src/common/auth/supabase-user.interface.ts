export interface SupabaseUser {
  id: string;
  email?: string;
  role?: string;
  appMetadata: Record<string, unknown>;
  userMetadata: Record<string, unknown>;
  /** Supabase session id from the access token, used for server-side revocation. */
  sessionId?: string;
  accessToken?: string;
}
