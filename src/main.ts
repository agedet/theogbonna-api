import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
// import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Serve static assets (for email templates)
  // Try dist/public first (production), then fallback to root public (development)
  // const publicPath = join(__dirname, '..', 'public');
  // app.useStaticAssets(publicPath, {
  //   prefix: '/assets/',
  // });

  // Trust proxy (important for correct IP detection and HTTPS detection)
  app.getHttpAdapter().getInstance().set('trust proxy', true);


  // Global validation — strips unknown fields, returns readable error messages
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false, // Allow extra properties (they'll be stripped by whitelist anyway)
      transform: true,
      transformOptions: {
        excludeExtraneousValues: false, // Set to false - only exclude if @Exclude() is used on DTO
        enableImplicitConversion: true, // Enable implicit type conversion
      },
      skipUndefinedProperties: false, // Validate undefined properties
      skipNullProperties: false, // Validate null properties
      skipMissingProperties: false, // Validate missing properties
    }),
  );

  // CORS configuration
  const corsOrigin = configService.get<string[]>('cors.origin');
  const nodeEnv =
    configService.get<string>('nodeEnv') ||
    process.env.NODE_ENV ||
    'development';
  const allowedOrigins = corsOrigin?.length
    ? corsOrigin
    : [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:5173',
        'http://localhost:5174',
        'http://127.0.0.1:3000',
        'http://127.0.1:3001',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:5174',
        'http://127.0.0.1:5175',
        'https://www.ogbonnasmemorial.com',
        'https://ogbonnasmemorial.com',
        'https://theogbonna.vercel.app',
      ];


  // Add request logging middleware to debug CORS issues and request bodies
  app.use((req, res, next) => {
    // Log request body for verify-otp endpoint in development
    if (
      process.env.NODE_ENV === 'development' &&
      req.path.includes('/auth/verify-otp') &&
      req.method === 'POST'
    ) {
      let bodyData = '';
      req.on('data', chunk => {
        bodyData += chunk.toString();
      });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(bodyData);
        } catch (e) {
          console.log('❌ Failed to parse body as JSON:', e);
        }
      });
    }

    next();
  });

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) {
        return callback(null, true);
      }

      // Normalize origin (remove trailing slashes)
      const normalizedOrigin = origin.endsWith('/')
        ? origin.slice(0, -1)
        : origin;

      // Check if origin is in allowed list
      if (allowedOrigins.includes(normalizedOrigin)) {
        return callback(null, true);
      }

      // In development, allow localhost on any port
      if (
        nodeEnv === 'development' &&
        (normalizedOrigin.startsWith('http://localhost:') ||
          normalizedOrigin.startsWith('http://127.0.0.1:'))
      ) {
        return callback(null, true);
      }

      // Reject other origins
      callback(new Error(`Not allowed by CORS: ${normalizedOrigin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
      'Cookie',
      'Set-Cookie',
      'Access-Control-Request-Method',
      'Access-Control-Request-Headers',
    ],
    exposedHeaders: ['Set-Cookie', 'Cookie'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  app.use(helmet());

  const port = configService.get('port') || 3001;

  await app.listen(port);

  console.log(`Application is running on http://localhost:${port}`);
}
bootstrap();
