import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { role } from '@prisma/client';
import { DatabaseService } from 'src/database/database.service';
import { ConfigService } from '@nestjs/config';

type JwtPayload = {
  sub: string;
  email?: string;
  role?: role;
  companyId?: string | null;
  tokenVersion?: number;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private prisma: DatabaseService,
    private configService: ConfigService,
  ) {
    const jwtSecret =
      configService.get<string>('security.jwtSecret') || 'default-jwt-secret';

    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request) => {
          const token = request?.cookies?.accessToken;
          return typeof token === 'string' ? token.trim() : null;
        },
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    });
  }

  async validate(payload: JwtPayload) {
    try {
      const user = await this.validateUserWithRetry(payload.sub);

      if (!user || user.deleted_at) {
        throw new UnauthorizedException('User not found');
      }

      const tokenVersion = payload.tokenVersion ?? 0;
      const userTokenVersion = this.getTokenVersion(user.raw_user_meta_data);
      if (tokenVersion !== userTokenVersion) {
        throw new UnauthorizedException(
          'Session expired. Please log in again.',
        );
      }

      return {
        id: user.id,
        email: user.email,
        firstName: user.profile?.first_name ?? null,
        lastName: user.profile?.last_name ?? null,
        role: user.profile?.role ?? payload.role ?? role.admin,
        companyId: user.profile?.company_id ?? payload.companyId ?? null,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      if (this.isDatabaseConnectionError(error)) {
        console.warn(
          'Database connection error during JWT validation, using token payload as fallback',
        );

        return {
          id: payload.sub,
          email: payload.email,
          role: payload.role ?? role.admin,
          companyId: payload.companyId ?? null,
        };
      }

      throw new UnauthorizedException('Invalid token');
    }
  }

  private async validateUserWithRetry(userId: string, maxRetries = 2) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.prisma.users.findUnique({
          where: { id: userId },
          include: { profile: true },
        });
      } catch (error) {
        if (attempt === maxRetries) {
          throw error;
        }

        if (this.isDatabaseConnectionError(error)) {
          console.warn(
            `Database connection error on attempt ${attempt}, retrying...`,
          );
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }

        throw error;
      }
    }
  }

  private getTokenVersion(rawMeta: unknown): number {
    if (
      rawMeta &&
      typeof rawMeta === 'object' &&
      rawMeta !== null &&
      'tokenVersion' in rawMeta
    ) {
      const version = Number((rawMeta as { tokenVersion?: number }).tokenVersion);
      return Number.isFinite(version) ? version : 0;
    }
    return 0;
  }

  private isDatabaseConnectionError(error: unknown): boolean {
    const err = error as { message?: string; code?: string };
    const errorMessage = err?.message?.toLowerCase() || '';
    const errorCode = err?.code || '';

    return (
      errorMessage.includes('connection') ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('econnrefused') ||
      errorMessage.includes('enotfound') ||
      errorCode === 'P1001' ||
      errorCode === 'P1002' ||
      errorCode === 'P1008' ||
      errorCode === 'P1017'
    );
  }
}
