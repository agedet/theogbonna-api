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
   * Cookie settings for SPA (www) ↔ API (api) on the same registrable domain.
   *
   * Production: SameSite=lax + Secure + Domain=.example.com so the browser
   * sends accessToken on credentialed cross-origin fetches to the API host.
   */
  getCookieOptionsFromRequest(req: Request, maxAge: number): CookieOptions {
    const nodeEnv = process.env.NODE_ENV || 'local';
    const isProduction = nodeEnv === 'production';

    const hostHeader = req.headers.host || '';
    const originHeader = (req.headers.origin as string) || '';
    const hostname = (hostHeader.split(':')[0] || '').toLowerCase();

    const isLocalHost =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      originHeader.startsWith('http://localhost') ||
      originHeader.startsWith('http://127.0.0.1') ||
      originHeader.startsWith('https://localhost') ||
      originHeader.startsWith('https://127.0.0.1');

    const forwardedProto = (
      (req.headers['x-forwarded-proto'] as string) || ''
    ).toLowerCase();
    const isHttps = req.secure === true || forwardedProto === 'https';

    // lax works for same-site subdomain SPA↔API; none only needed when truly cross-site
    const sameSite: 'strict' | 'lax' | 'none' = isProduction
      ? 'lax'
      : isLocalHost
        ? isHttps
          ? 'none'
          : 'lax'
        : 'lax';

    const secure = isProduction ? true : isLocalHost ? isHttps : false;

    const configuredDomain =
      this.configService.get<string>('security.cookieDomain') ||
      process.env.COOKIE_DOMAIN;

    // Normalize to leading-dot form so www + api share the cookie
    let domain: string | undefined;
    if (isProduction && configuredDomain) {
      domain = configuredDomain.startsWith('.')
        ? configuredDomain
        : `.${configuredDomain}`;
    }

    return {
      httpOnly: true,
      secure,
      sameSite,
      maxAge,
      path: '/',
      ...(domain ? { domain } : {}),
    };
  }

  setAccessTokenCookie(
    res: Response,
    token: string,
    req?: Request,
    maxAge?: number,
  ): void {
    const maxAgeMs = maxAge || 12 * 60 * 60 * 1000;
    const options = req
      ? this.getCookieOptionsFromRequest(req, maxAgeMs)
      : this.getCookieOptions(maxAgeMs);
    res.cookie('accessToken', token, options);
  }

  setRefreshTokenCookie(
    res: Response,
    token: string,
    req?: Request,
    maxAge?: number,
  ): void {
    const maxAgeMs = maxAge || 7 * 24 * 60 * 60 * 1000;
    const options = req
      ? this.getCookieOptionsFromRequest(req, maxAgeMs)
      : this.getCookieOptions(maxAgeMs);
    res.cookie('refreshToken', token, options);
  }

  clearAccessTokenCookie(res: Response, req?: Request): void {
    const options = req
      ? this.getCookieOptionsFromRequest(req, 0)
      : this.getCookieOptions(0);
    res.clearCookie('accessToken', options);
  }

  clearRefreshTokenCookie(res: Response, req?: Request): void {
    const options = req
      ? this.getCookieOptionsFromRequest(req, 0)
      : this.getCookieOptions(0);
    res.clearCookie('refreshToken', options);
  }

  clearAllAuthCookies(res: Response, req?: Request): void {
    this.clearAccessTokenCookie(res, req);
    this.clearRefreshTokenCookie(res, req);
  }

  private getCookieOptions(maxAge: number): CookieOptions {
    const isProduction = process.env.NODE_ENV === 'production';
    const configuredDomain =
      this.configService.get<string>('security.cookieDomain') ||
      process.env.COOKIE_DOMAIN;

    let domain: string | undefined;
    if (isProduction && configuredDomain) {
      domain = configuredDomain.startsWith('.')
        ? configuredDomain
        : `.${configuredDomain}`;
    }

    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'lax' : 'lax',
      maxAge,
      path: '/',
      ...(domain ? { domain } : {}),
    };
  }
}
