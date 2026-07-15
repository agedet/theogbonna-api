export const DEFAULT_CORS_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:5175',
  'https://www.ogbonnasmemorial.com',
  'https://ogbonnasmemorial.com',
  'https://theogbonna.vercel.app',
];

export function resolveAllowedOrigins(
  configured?: string[] | null,
): string[] {
  return Array.from(
    new Set([
      ...DEFAULT_CORS_ORIGINS,
      ...(configured?.filter(Boolean) ?? []),
    ]),
  );
}

export function createCorsOptions(allowedOrigins: string[], nodeEnv: string) {
  return {
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Mobile apps, curl, server-to-server
      if (!origin) {
        return callback(null, true);
      }

      const normalizedOrigin = origin.endsWith('/')
        ? origin.slice(0, -1)
        : origin;

      if (allowedOrigins.includes(normalizedOrigin)) {
        return callback(null, true);
      }

      if (
        nodeEnv !== 'production' &&
        (normalizedOrigin.startsWith('http://localhost:') ||
          normalizedOrigin.startsWith('http://127.0.0.1:'))
      ) {
        return callback(null, true);
      }

      // Reject without throwing — throwing becomes a 500 with no CORS headers
      return callback(null, false);
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
  };
}
