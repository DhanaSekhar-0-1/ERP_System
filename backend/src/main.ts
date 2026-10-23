import { ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/http/exception.filter';
import { requestContextMiddleware } from './common/http/request-context';
import { ResponseEnvelopeInterceptor } from './common/http/response.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const config = app.get(ConfigService);

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(requestContextMiddleware);
  app.enableCors({
    origin: config.get<string>('CORS_ORIGINS', 'http://localhost:3001').split(','),
    credentials: true,
  });
  app.setGlobalPrefix(config.get<string>('API_PREFIX', 'api/v1'));
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor(app.get(Reflector)));

  await app.listen(config.get<number>('PORT', 3000));
}

void bootstrap();
