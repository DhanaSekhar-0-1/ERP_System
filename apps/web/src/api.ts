import { AuthTokens, createApi } from '@erp/shared';

const KEY = 'erp.session';

/** Fires after the session ends so the auth provider can return to the login page. */
export const signedOut = new EventTarget();

export const api = createApi({
  baseUrl: () => import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1',
  store: {
    async load() {
      try {
        const saved = localStorage.getItem(KEY);
        return saved ? (JSON.parse(saved) as AuthTokens) : null;
      } catch {
        return null;
      }
    },
    async save(tokens) {
      try {
        if (tokens) localStorage.setItem(KEY, JSON.stringify(tokens));
        else localStorage.removeItem(KEY);
      } catch {
        // Private windows may block storage; the session then lasts until reload.
      }
    },
  },
  onSignedOut: () => signedOut.dispatchEvent(new Event('signedout')),
});
