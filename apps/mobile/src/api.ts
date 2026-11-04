import { createApi } from '@erp/shared';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const ACCESS = 'erp.access';
const REFRESH = 'erp.refresh';
const SERVER = 'erp.server';

/** SecureStore has no web build; the browser preview falls back to localStorage. */
const storage = {
  get: (key: string): Promise<string | null> =>
    Platform.OS === 'web' ? Promise.resolve(localStorage.getItem(key)) : SecureStore.getItemAsync(key),
  set: (key: string, value: string): Promise<void> =>
    Platform.OS === 'web' ? Promise.resolve(localStorage.setItem(key, value)) : SecureStore.setItemAsync(key, value),
  remove: (key: string): Promise<void> =>
    Platform.OS === 'web' ? Promise.resolve(localStorage.removeItem(key)) : SecureStore.deleteItemAsync(key),
};

export const defaultServer = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';
let server = defaultServer;

export const getServer = () => server;

export async function loadServer(): Promise<void> {
  server = (await storage.get(SERVER)) ?? defaultServer;
}

export async function saveServer(value: string): Promise<void> {
  server = value.trim().replace(/\/+$/, '');
  await storage.set(SERVER, server);
}

let signedOutListener: () => void = () => undefined;
export const onSignedOut = (listener: () => void) => {
  signedOutListener = listener;
};

export const api = createApi({
  baseUrl: getServer,
  store: {
    async load() {
      const [accessToken, refreshToken] = await Promise.all([storage.get(ACCESS), storage.get(REFRESH)]);
      return accessToken && refreshToken ? { accessToken, refreshToken } : null;
    },
    async save(tokens) {
      if (tokens) {
        await Promise.all([storage.set(ACCESS, tokens.accessToken), storage.set(REFRESH, tokens.refreshToken)]);
      } else {
        await Promise.all([storage.remove(ACCESS), storage.remove(REFRESH)]);
      }
    },
  },
  onSignedOut: () => signedOutListener(),
});
