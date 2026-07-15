export enum Role {
  ADMIN = 'ADMIN',
  SUPERADMIN = 'SUPERADMIN',
}

export const RATE_LIMITS = {
  LOGIN: {
    ttl: 60, // 1 minute
    limit: 5, // 5 attempts
  },
  GENERAL: {
    ttl: 60, // 1 minute
    limit: 100, // 100 requests
  },
} as const;

export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
};

export const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};