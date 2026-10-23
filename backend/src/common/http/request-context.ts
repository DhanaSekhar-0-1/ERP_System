import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface RequestMetadata {
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

const storage = new AsyncLocalStorage<RequestMetadata>();

export function requestContextMiddleware(
  request: { headers: Record<string, string | string[] | undefined>; ip?: string },
  _response: unknown,
  next: () => void,
): void {
  const header = request.headers['x-request-id'];
  const userAgent = request.headers['user-agent'];
  storage.run(
    {
      requestId: typeof header === 'string' && header ? header : randomUUID(),
      ipAddress: request.ip,
      userAgent: typeof userAgent === 'string' ? userAgent : undefined,
    },
    next,
  );
}

export function currentRequest(): RequestMetadata | undefined {
  return storage.getStore();
}
