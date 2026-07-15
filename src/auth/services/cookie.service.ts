import { Injectable } from '@nestjs/common';
import { Response, Request } from 'express';
import { ConfigService } from '@nestjs/config';

export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
  domain?: string;
  maxAge?: number;
  path?: string;
}

@Injectable()
export class CookieService {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Build cookie options using the incoming request context.
   * This method intelligently determines cookie settings based on:
   * - Environment (production, development, local)
   * - Request origin (localhost, production domain)
   * - HTTPS status
   *
   * Rules:
   * - production: SameSite 'strict', secure true, domain set
   * - development: SameSite 'lax', secure false
   * - local (localhost/127.0.0.1): SameSite 'none' only when HTTPS; otherwise 'lax'
   */
  getCookieOptionsFromRequest(req: Request, maxAge: number): CookieOptions {
    const nodeEnv = process.env.NODE_ENV || 'local';
    const isProduction = nodeEnv === 'production';
    const isDevelopment = nodeEnv === 'development';

    // Extract hostname from request
    const hostHeader = req.headers.host || '';
    const originHeader = (req.headers.origin as string) || '';
    const hostname = (hostHeader.split(':')[0] || '').toLowerCase();

    // Detect localhost
    const isLocalHost =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      originHeader.startsWith('http://localhost') ||
      originHeader.startsWith('http://127.0.0.1') ||
      originHeader.startsWith('https://localhost') ||
      originHeader.startsWith('https://127.0.0.1');

    // Detect HTTPS (check both req.secure and x-forwarded-proto header)
    const forwardedProto = (
      (req.headers['x-forwarded-proto'] as string) || ''
    ).toLowerCase();
    const isHttps = req.secure === true || forwardedProto === 'https';

    // Determine SameSite attribute
    const sameSite: 'strict' | 'lax' | 'none' = isProduction
      ? 'strict'
      : isLocalHost
        ? isHttps
          ? 'none'
          : 'lax'
        : 'lax';

    // Determine secure flag
    const secure = isProduction ? true : isLocalHost ? isHttps : false;

    return {
      httpOnly: true, // Always HTTP-only (prevents XSS)
      secure, // HTTPS only in production or localhost with HTTPS
      sameSite, // Environment-aware SameSite
      maxAge, // Expiration in milliseconds
      path: '/',
      domain: isProduction
        ? this.configService.get<string>('COOKIE_DOMAIN')
        : undefined,
    };
  }

  /**
   * Set JWT access token cookie
   * Default expiration: 12 hours
   */
  setAccessTokenCookie(
    res: Response,
    token: string,
    req?: Request,
    maxAge?: number,
  ): void {
    const maxAgeMs = maxAge || 12 * 60 * 60 * 1000; // 12 hours in milliseconds
    const options = req
      ? this.getCookieOptionsFromRequest(req, maxAgeMs)
      : this.getCookieOptions(maxAgeMs);
    res.cookie('accessToken', token, options);
  }

  /**
   * Set JWT refresh token cookie
   * Default expiration: 7 days
   */
  setRefreshTokenCookie(
    res: Response,
    token: string,
    req?: Request,
    maxAge?: number,
  ): void {
    const maxAgeMs = maxAge || 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
    const options = req
      ? this.getCookieOptionsFromRequest(req, maxAgeMs)
      : this.getCookieOptions(maxAgeMs);
    res.cookie('refreshToken', token, options);
  }

  /**
   * Clear access token cookie
   */
  clearAccessTokenCookie(res: Response, req?: Request): void {
    const options = req
      ? this.getCookieOptionsFromRequest(req, 0)
      : this.getCookieOptions(0);
    res.clearCookie('accessToken', options);
  }

  /**
   * Clear refresh token cookie
   */
  clearRefreshTokenCookie(res: Response, req?: Request): void {
    const options = req
      ? this.getCookieOptionsFromRequest(req, 0)
      : this.getCookieOptions(0);
    res.clearCookie('refreshToken', options);
  }

  /**
   * Clear all authentication cookies
   */
  clearAllAuthCookies(res: Response, req?: Request): void {
    this.clearAccessTokenCookie(res, req);
    this.clearRefreshTokenCookie(res, req);
  }

  /**
   * Private helper for basic cookie options (used when request is not available)
   */
  private getCookieOptions(maxAge: number): CookieOptions {
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieDomain = isProduction
      ? this.configService.get<string>('COOKIE_DOMAIN')
      : undefined;

    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      maxAge: maxAge,
      path: '/',
      domain: cookieDomain,
    };
  }
}