import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, Observable } from 'rxjs';

export const RAW_RESPONSE_KEY = 'rawResponse';

/** Skips the { data, meta, error } envelope, for CSV or HTML downloads. */
export const RawResponse = (): MethodDecorator =>
  SetMetadata(RAW_RESPONSE_KEY, true);

@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const raw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (raw) {
      return next.handle();
    }
    return next.handle().pipe(
      map((result: unknown) => {
        if (result instanceof StreamableFile) {
          return result;
        }
        if (
          result &&
          typeof result === 'object' &&
          !Array.isArray(result) &&
          'data' in result &&
          'meta' in result &&
          Object.keys(result).length === 2
        ) {
          const paged = result as { data: unknown; meta: unknown };
          return { data: paged.data, meta: paged.meta, error: null };
        }
        return { data: result ?? null, meta: {}, error: null };
      }),
    );
  }
}
