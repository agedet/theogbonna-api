import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import {
  createCorsOptions,
  resolveAllowedOrigins,
} from './config/cors.config.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Trust proxy (important for correct IP detection and HTTPS detection)
  app.getHttpAdapter().getInstance().set('trust proxy', true);

  // Required so JwtStrategy can read accessToken / refreshToken from req.cookies
  app.use(
    cookieParser(
      configService.get<string>('security.cookieSecret') ||
        process.env.COOKIE_SECRET,
    ),
  );

  // Global validation — strips unknown fields, returns readable error messages
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: {
        excludeExtraneousValues: false,
        enableImplicitConversion: true,
      },
      skipUndefinedProperties: false,
      skipNullProperties: false,
      skipMissingProperties: false,
    }),
  );

  const nodeEnv =
    configService.get<string>('nodeEnv') ||
    process.env.NODE_ENV ||
    'development';

  const allowedOrigins = resolveAllowedOrigins(
    configService.get<string[]>('cors.origin'),
  );

  // CORS before helmet so preflight always gets ACAO headers
  app.enableCors(createCorsOptions(allowedOrigins, nodeEnv));

  app.use(
    helmet({
      // APIs called from another origin need this; default can block responses
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  const port = configService.get('port') || process.env.PORT || 3001;

  await app.listen(port);

  console.log(`Application is running on http://localhost:${port}`);
  // console.log(`CORS allowed origins: ${allowedOrigins.join(', ')}`);
}
bootstrap();
