/** Map common provider aliases to real SMTP hostnames. */
function resolveSmtpHost(raw?: string): string {
  const host = raw?.trim();
  if (!host) return 'smtp.gmail.com';

  const aliases: Record<string, string> = {
    gmail: 'smtp.gmail.com',
    google: 'smtp.gmail.com',
    outlook: 'smtp.office365.com',
    hotmail: 'smtp.office365.com',
    office365: 'smtp.office365.com',
  };

  return aliases[host.toLowerCase()] ?? host;
}

export default () => ({
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  backendUrl:
    process.env.BACKEND_URL || `http://localhost:${process.env.PORT || '3001'}`,
  /** Client portal base URL for deep links in emails (e.g. https://client.ogbonnasmemorial.com). No trailing slash. */
  clientAppBaseUrl:
    process.env.CLIENT_APP_BASE_URL ||
    process.env.FRONTEND_URL ||
    'http://localhost:5173',
  database: {
    url: process.env.DATABASE_URL,
  },
  security: {
    cookieSecret: process.env.COOKIE_SECRET || 'default-cookie-secret',
    jwtSecret: process.env.JWT_SECRET || 'default-jwt-secret',
  },
  rateLimit: {
    ttl: parseInt(process.env.RATE_LIMIT_TTL || '60', 10),
    limit: parseInt(process.env.RATE_LIMIT_LIMIT || '10', 10),
  },
  cors: {
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
      : null,
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
  /** Min ms between any two emails (global throttle). Use to avoid SMTP rate limit (e.g. Microsoft 365 450 4.5.127).
   * Default: 10000ms (10 seconds) for Microsoft 365 compatibility. Increase if still hitting rate limits. */
  mailThrottleMs: parseInt(process.env.MAIL_THROTTLE_MS || '10000', 10),
  email: {
    // Prefer SMTP_*; fall back to MAIL_* used elsewhere in the app
    host: resolveSmtpHost(process.env.SMTP_HOST || process.env.MAIL_HOST),
    port: process.env.SMTP_PORT || process.env.MAIL_PORT || '587',
    secure: process.env.SMTP_SECURE || process.env.MAIL_SECURE || 'false',
    user: process.env.SMTP_USER || process.env.MAIL_USER,
    password: process.env.SMTP_PASS || process.env.MAIL_PASSWORD,
    from:
      process.env.SMTP_FROM ||
      process.env.MAIL_FROM ||
      'noreply@ogbonnasmemorial.com',
    fromName: process.env.SMTP_FROM_NAME || 'Ogbonnas Memorial',
    replyTo: process.env.SMTP_REPLY_TO,
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl: process.env.GOOGLE_CALLBACK_URL,
    calendarApiKey: process.env.GOOGLE_CALENDAR_API_KEY,
  },
});
