/** Map common provider aliases to real SMTP hostnames (legacy SMTP only). */
function resolveSmtpHost(raw?: string): string {
  const host = raw?.trim();
  if (!host) return 'smtp.resend.com';

  const aliases: Record<string, string> = {
    gmail: 'smtp.gmail.com',
    google: 'smtp.gmail.com',
    resend: 'smtp.resend.com',
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
  mailThrottleMs: parseInt(process.env.MAIL_THROTTLE_MS || '500', 10),
  email: {
    /** Primary: Resend HTTP API (used by MailService) */
    resendApiKey: process.env.RESEND_API_KEY || process.env.SMTP_PASS,
    from:
      process.env.EMAIL_FROM ||
      process.env.RESEND_FROM ||
      process.env.SMTP_FROM ||
      process.env.MAIL_FROM ||
      'Ogbonna Memorial <info@ogbonnasmemorial.com>',
    fromName: process.env.SMTP_FROM_NAME || 'Ogbonnas Memorial',
    fromAddress:
      process.env.EMAIL_FROM_ADDRESS || 'info@ogbonnasmemorial.com',
    replyTo: process.env.SMTP_REPLY_TO || process.env.EMAIL_REPLY_TO,

    /** Legacy SMTP fields (kept for backwards compatibility) */
    host: resolveSmtpHost(process.env.SMTP_HOST || process.env.MAIL_HOST),
    port: process.env.SMTP_PORT || process.env.MAIL_PORT || '465',
    secure: process.env.SMTP_SECURE || process.env.MAIL_SECURE || 'true',
    user: process.env.SMTP_USER || process.env.MAIL_USER,
    password: process.env.SMTP_PASS || process.env.MAIL_PASSWORD,
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl: process.env.GOOGLE_CALLBACK_URL,
    calendarApiKey: process.env.GOOGLE_CALENDAR_API_KEY,
  },
});
