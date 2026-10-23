import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { currentRequest } from './request-context';

interface HttpResponseLike {
  status(code: number): { json(body: unknown): void };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponseLike>();
    const { status, message, details } = this.describe(exception);
    if (status >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : exception);
    }
    response.status(status).json({
      data: null,
      meta: { requestId: currentRequest()?.requestId },
      error: { statusCode: status, message, details },
    });
  }

  private describe(exception: unknown): {
    status: number;
    message: string;
    details?: unknown;
  } {
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null && 'message' in body) {
        const raw = (body as { message: unknown }).message;
        return {
          status: exception.getStatus(),
          message: Array.isArray(raw) ? 'Validation failed' : String(raw),
          details: Array.isArray(raw) ? raw : undefined,
        };
      }
      return { status: exception.getStatus(), message: String(body) };
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return {
            status: HttpStatus.CONFLICT,
            message: 'A record with these values already exists',
            details: exception.meta?.target,
          };
        case 'P2003':
          return {
            status: HttpStatus.CONFLICT,
            message: 'This record is referenced by other records or references a missing record',
          };
        case 'P2025':
          return { status: HttpStatus.NOT_FOUND, message: 'Record not found' };
        case 'P2023':
          return { status: HttpStatus.BAD_REQUEST, message: 'Invalid identifier format' };
        default:
          return { status: HttpStatus.BAD_REQUEST, message: 'Database request failed' };
      }
    }
    if (exception instanceof Prisma.PrismaClientValidationError) {
      return { status: HttpStatus.BAD_REQUEST, message: 'Invalid request values' };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    };
  }
}
