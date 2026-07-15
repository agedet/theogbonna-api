import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { MailService } from '../mail/mail.service';
import { DatabaseService } from '../database/database.service';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { OtpPurpose, ResendOtpDto } from './dto/resend-otp.dto';

export interface AuthUserPayload {
  id: string;
  role: role;
  companyId: string | null;
}

type SessionJwtPayload = {
  sub: string;
  email: string;
  type: 'session';
};

type AuthJwtPayload = {
  sub: string;
  email: string;
  role: role;
  companyId?: string | null;
  tokenVersion: number;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
  ) {}

  async validateUser(email: string, password: string) {
    const normalizedEmail = email.toLowerCase().trim();

    const user = await this.prisma.users.findFirst({
      where: { email: normalizedEmail, deleted_at: null },
      include: { profile: true },
    });

    if (!user?.encrypted_password) {
      return null;
    }

    const isValid = await bcrypt.compare(password, user.encrypted_password);
    if (!isValid) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.profile?.first_name ?? null,
      lastName: user.profile?.last_name ?? null,
      role: user.profile?.role ?? role.admin,
    };
  }

  async findUserById(id: string) {
    return this.prisma.users.findUnique({
      where: { id },
      include: { profile: true },
    });
  }

  async register(dto: RegisterDto) {
    const {
      firstName,
      lastName,
      email,
      password,
      phoneNumber,
      state,
      country,
      dateOfBirth,
      termsAndConditions,
    } = dto;

    const normalizedEmail = email.toLowerCase().trim();

    if (!termsAndConditions) {
      throw new BadRequestException('You must agree to terms and conditions');
    }

    const existingUser = await this.prisma.users.findFirst({
      where: { email: normalizedEmail },
    });

    const existingProfile = await this.prisma.profile.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser || existingProfile) {
      throw new ConflictException('User with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const userId = randomUUID();

    await this.prisma.users.create({
      data: {
        id: userId,
        email: normalizedEmail,
        encrypted_password: hashedPassword,
        instance_id: '00000000-0000-0000-0000-000000000000',
        is_anonymous: false,
        raw_user_meta_data: { tokenVersion: 0 },
        profile: {
          create: {
            email: normalizedEmail,
            first_name: firstName?.trim() || '',
            last_name: lastName?.trim() || '',
            phone_number: phoneNumber?.trim() || null,
            state: state?.trim() || null,
            country: country?.trim() || null,
            date_of_birth: dateOfBirth ? new Date(dateOfBirth) : null,
            terms_and_conditions: termsAndConditions,
            role: role.admin,
          },
        },
      },
    });

    await this.createAndSendOtp(normalizedEmail, firstName?.trim() || 'User', undefined, 30);

    return {
      message: 'Account created. Please verify your email.',
      email: normalizedEmail,
    };
  }

  async verifyRegistration(emailInput: string, otpCode: string) {
    const email = emailInput.trim().toLowerCase();
    await this.assertValidOtp(email, otpCode);

    const profile = await this.prisma.profile.findUnique({
      where: { email },
    });

    if (!profile) {
      throw new UnauthorizedException('Invalid email or verification code');
    }

    if (profile.is_email_verified) {
      return {
        message: 'Email is already verified. Please sign in.',
        email,
        alreadyVerified: true,
      };
    }

    await this.prisma.$transaction([
      this.prisma.users.update({
        where: { id: profile.id },
        data: { email_confirmed_at: new Date() },
      }),
      this.prisma.profile.update({
        where: { id: profile.id },
        data: { is_email_verified: true },
      }),
    ]);

    await this.clearOtp(email);

    return {
      message: 'Email verified successfully. Please sign in to continue.',
      email,
    };
  }

  async login(user: {
    id: string;
    email: string;
    firstName?: string | null;
  }) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: user.id },
    });

    let isEmailVerified = profile?.is_email_verified ?? false;

    if (!isEmailVerified) {
      const authUser = await this.prisma.users.findUnique({
        where: { id: user.id },
        select: { email_confirmed_at: true },
      });

      if (authUser?.email_confirmed_at) {
        await this.prisma.profile.update({
          where: { id: user.id },
          data: { is_email_verified: true },
        });
        isEmailVerified = true;
      }
    }

    if (!isEmailVerified) {
      if (!user.email) {
        throw new UnauthorizedException(
          'Please verify your email before signing in.',
        );
      }

      const normalizedEmail = user.email.toLowerCase().trim();
      await this.createAndSendOtp(
        normalizedEmail,
        user.firstName || profile?.first_name || 'User',
        undefined,
        30,
      );

      return {
        requiresEmailVerification: true,
        email: normalizedEmail,
        message:
          'Your email is not verified yet. A new verification code has been sent to your email.',
      };
    }

    const otpCode = this.generateOtp();
    const sessionToken = await this.generateSessionToken(user.id, user.email);

    await this.createAndSendOtp(
      user.email.toLowerCase().trim(),
      user.firstName || 'User',
      otpCode,
      10,
    );

    return {
      sessionToken,
      message: 'Verification code sent to your email',
      requiresTwoFactor: true,
    };
  }

  async verifyOtp(sessionToken: string, otpCode: string) {
    if (!sessionToken?.trim() || !otpCode?.trim()) {
      throw new BadRequestException('Session token and OTP code are required');
    }

    const normalizedOtp = otpCode.trim();
    if (normalizedOtp.length !== 6) {
      throw new BadRequestException('OTP code must be exactly 6 digits');
    }

    let sessionPayload: SessionJwtPayload;
    try {
      sessionPayload = this.jwtService.verify<SessionJwtPayload>(sessionToken.trim());
    } catch (error: unknown) {
      const jwtError = error as { name?: string };
      if (jwtError.name === 'TokenExpiredError') {
        throw new UnauthorizedException(
          'Session token has expired. Please login again.',
        );
      }
      throw new UnauthorizedException('Invalid session token');
    }

    if (sessionPayload.type !== 'session' || !sessionPayload.sub) {
      throw new UnauthorizedException('Invalid session token type');
    }

    const user = await this.prisma.users.findFirst({
      where: { id: sessionPayload.sub, deleted_at: null },
      include: { profile: true },
    });

    if (!user?.email) {
      throw new UnauthorizedException('Invalid session token');
    }

    await this.assertValidOtp(user.email, normalizedOtp);

    const tokenVersion = this.getTokenVersion(user.raw_user_meta_data);
    const userRole = user.profile?.role ?? role.admin;
    const { accessToken, refreshToken } = await this.generateTokens(
      user.id,
      user.email,
      userRole,
      user.profile?.company_id ?? null,
      tokenVersion,
    );

    await this.storeRefreshToken(user.id, refreshToken);
    await this.clearOtp(user.email);

    await this.prisma.users.update({
      where: { id: user.id },
      data: { last_sign_in_at: new Date() },
    });

    return {
      accessToken,
      refreshToken,
      user: this.buildAuthUser(user),
    };
  }

  // NOTE: completeOnboarding and company-related methods are not applicable
  // to this project's schema. Stubbed to prevent compile errors.
  async completeOnboarding(_user: AuthUserPayload, _dto: unknown) {
    throw new BadRequestException('Onboarding is not configured for this application.');
  }

  async getSession(user: AuthUserPayload) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: user.id },
      include: { users: true },
    });

    if (!profile) throw new UnauthorizedException();

    return {
      id:              profile.id,
      userId:          profile.id,
      email:           profile.email,
      firstName:       profile.first_name,
      middleName:      profile.middle_name,
      lastName:        profile.last_name,
      role:            profile.role,
      state:           profile.state,
      country:         profile.country,
      dateOfBirth:     profile.date_of_birth,
      isEmailVerified: profile.is_email_verified,
      companyId:       profile.company_id,
      company:         null,
      permissions:     [profile.role],
      picture:         null,
      createdAt:       profile.created_at,
    };
  }

  async refreshSession(user: AuthUserPayload) {
    return this.createAuthSession(user.id, user.companyId);
  }

  async refreshToken(refreshToken: string) {
    try {
      const payload = await this.jwtService.verifyAsync<AuthJwtPayload>(refreshToken);

      const user = await this.prisma.users.findUnique({
        where: { id: payload.sub },
        include: { profile: true },
      });

      if (!user || user.deleted_at) {
        throw new UnauthorizedException('User not found or inactive');
      }

      const tokenVersion = this.getTokenVersion(user.raw_user_meta_data);
      if ((payload.tokenVersion ?? 0) !== tokenVersion) {
        throw new UnauthorizedException('Session expired. Please log in again.');
      }

      const isValidToken = await this.verifyStoredRefreshToken(
        user.id,
        refreshToken,
      );

      if (!isValidToken) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const userRole = user.profile?.role ?? role.admin;
      const tokens = await this.generateTokens(
        user.id,
        user.email ?? payload.email,
        userRole,
        user.profile?.company_id ?? null,
        tokenVersion,
      );

      await this.storeRefreshToken(user.id, tokens.refreshToken);

      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user: this.buildAuthUser(user),
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      const jwtError = error as { name?: string };
      const message =
        jwtError.name === 'TokenExpiredError'
          ? 'Refresh token has expired'
          : 'Invalid or expired refresh token';

      throw new UnauthorizedException(message);
    }
  }

  async refreshTokens(refreshToken: string) {
    return this.refreshToken(refreshToken);
  }

  async logout(userId: string) {
    await this.prisma.refresh_tokens.updateMany({
      where: { user_id: userId, revoked: { not: true } },
      data: { revoked: true },
    });
  }

  async resendOtp(dto: ResendOtpDto) {
    switch (dto.purpose) {
      case OtpPurpose.registration:
        return this.resendRegistrationOtp(dto.email);
      case OtpPurpose.password_reset:
        return this.resendPasswordResetOtp(dto.email);
      case OtpPurpose.login:
        return this.resendLoginOtp(dto.sessionToken);
      default:
        throw new BadRequestException('Invalid OTP purpose');
    }
  }

  private async resendRegistrationOtp(email?: string) {
    if (!email?.trim()) {
      throw new BadRequestException('Email is required');
    }

    const normalizedEmail = email.toLowerCase().trim();
    const profile = await this.prisma.profile.findUnique({
      where: { email: normalizedEmail },
    });

    if (!profile) {
      throw new BadRequestException('Account not found for this email');
    }

    if (profile.is_email_verified) {
      throw new BadRequestException('Email is already verified. Please sign in.');
    }

    await this.createAndSendOtp(
      normalizedEmail,
      profile.first_name || 'User',
      undefined,
      30,
    );

    return {
      message: 'A new verification code has been sent to your email.',
    };
  }

  private async resendPasswordResetOtp(email?: string) {
    if (!email?.trim()) {
      throw new BadRequestException('Email is required');
    }

    return this.forgotPassword({ email });
  }

  private async resendLoginOtp(sessionToken?: string) {
    if (!sessionToken?.trim()) {
      throw new BadRequestException('Session token is required');
    }

    let sessionPayload: SessionJwtPayload;
    try {
      sessionPayload = this.jwtService.verify<SessionJwtPayload>(sessionToken.trim());
    } catch {
      throw new UnauthorizedException(
        'Session expired. Please sign in again to receive a new code.',
      );
    }

    if (sessionPayload.type !== 'session' || !sessionPayload.sub) {
      throw new UnauthorizedException('Invalid session token');
    }

    const user = await this.prisma.users.findFirst({
      where: { id: sessionPayload.sub, deleted_at: null },
      include: { profile: true },
    });

    if (!user?.email) {
      throw new UnauthorizedException('Invalid session token');
    }

    if (!user.profile?.is_email_verified) {
      throw new UnauthorizedException(
        'Please verify your email before signing in.',
      );
    }

    await this.createAndSendOtp(
      user.email.toLowerCase().trim(),
      user.profile.first_name || 'User',
      undefined,
      10,
    );

    return {
      message: 'A new verification code has been sent to your email.',
    };
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    const normalizedEmail = forgotPasswordDto.email.toLowerCase().trim();

    const user = await this.prisma.users.findFirst({
      where: { email: normalizedEmail, deleted_at: null },
      include: { profile: true },
    });

    if (!user?.encrypted_password) {
      return {
        message:
          'If an account exists with this email, a password reset code has been sent.',
      };
    }

    const otpCode = this.generateOtp();
    await this.createAndSendOtp(
      normalizedEmail,
      user.profile?.first_name || 'User',
      otpCode,
      15,
    );

    return {
      message:
        'If an account with that email exists, a password reset code has been sent.',
    };
  }

  async verifyForgotPasswordOtp(email: string, otpCode: string) {
    const normalizedEmail = email.toLowerCase().trim();

    const user = await this.prisma.users.findFirst({
      where: { email: normalizedEmail, deleted_at: null },
    });

    if (!user) {
      throw new BadRequestException('Invalid email or OTP code');
    }

    const isValid = await this.verifyStoredOtp(normalizedEmail, otpCode);
    if (!isValid) {
      throw new UnauthorizedException('Invalid or expired OTP code');
    }

    return { message: 'OTP verified successfully' };
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const { email, newPassword, otpCode, confirmPassword } = resetPasswordDto;

    if (newPassword !== confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const normalizedEmail = email.toLowerCase().trim();

    const user = await this.prisma.users.findFirst({
      where: { email: normalizedEmail, deleted_at: null },
      include: { profile: true },
    });

    if (!user) {
      throw new BadRequestException('Invalid email or OTP code');
    }

    if (!user.encrypted_password) {
      throw new BadRequestException(
        'This account does not have a password. Please contact support.',
      );
    }

    const isValid = await this.verifyStoredOtp(normalizedEmail, otpCode);
    if (!isValid) {
      throw new UnauthorizedException('Invalid or expired OTP code');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    const newTokenVersion = this.getTokenVersion(user.raw_user_meta_data) + 1;

    await this.prisma.users.update({
      where: { id: user.id },
      data: {
        encrypted_password: hashedPassword,
        raw_user_meta_data: {
          ...(typeof user.raw_user_meta_data === 'object' &&
          user.raw_user_meta_data !== null
            ? (user.raw_user_meta_data as Record<string, unknown>)
            : {}),
          tokenVersion: newTokenVersion,
        },
      },
    });

    await this.revokeRefreshTokens(user.id);
    await this.clearOtp(normalizedEmail);

    return {
      message: 'Password has been reset successfully.',
      user: this.buildAuthUser(user),
    };
  }

  async setupPasswordWithInvitation(
    invitationToken: string,
    newPassword: string,
    confirmPassword: string,
  ) {
    if (newPassword !== confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    if (newPassword.length < 8) {
      throw new BadRequestException(
        'Password must be at least 8 characters long',
      );
    }

    const user = await this.prisma.users.findFirst({
      where: { recovery_token: invitationToken },
      include: { profile: true },
    });

    if (!user) {
      throw new UnauthorizedException(
        'Invalid invitation link. Please contact support or request a new invitation.',
      );
    }

    if (
      !user.recovery_sent_at ||
      user.recovery_sent_at.getTime() + 7 * 24 * 60 * 60 * 1000 < Date.now()
    ) {
      throw new UnauthorizedException(
        'Invitation link has expired. Please request a new invitation from your administrator.',
      );
    }

    if (user.last_sign_in_at) {
      throw new BadRequestException(
        'This invitation has already been used. Please use the regular login or password reset flow.',
      );
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await this.prisma.users.update({
      where: { id: user.id },
      data: {
        encrypted_password: hashedPassword,
        recovery_token: null,
        recovery_sent_at: null,
        last_sign_in_at: new Date(),
      },
    });

    await this.revokeRefreshTokens(user.id);

    return {
      message: 'Password set up successfully. You can now log in.',
      user: this.buildAuthUser(user),
    };
  }

  async verifyInvitationToken(invitationToken: string) {
    const user = await this.prisma.users.findFirst({
      where: { recovery_token: invitationToken },
      include: { profile: true },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid invitation link');
    }

    if (
      !user.recovery_sent_at ||
      user.recovery_sent_at.getTime() + 7 * 24 * 60 * 60 * 1000 < Date.now()
    ) {
      throw new UnauthorizedException('Invitation link has expired');
    }

    if (user.last_sign_in_at) {
      throw new BadRequestException('Invitation has already been used');
    }

    return {
      valid: true,
      user: {
        email: user.email,
        firstName: user.profile?.first_name,
        lastName: user.profile?.last_name,
        role: user.profile?.role,
      },
    };
  }

  async getUserProfile(userId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
      include: { users: true },
    });

    if (!profile || profile.users?.deleted_at) {
      throw new UnauthorizedException('User not found');
    }

    return {
      id: profile.id,
      email: profile.email,
      username: profile.email.split('@')[0],
      firstName: profile.first_name,
      lastName: profile.last_name,
      role: profile.role,
      permissions: [profile.role],
      isGoogleUser: false,
      picture: null,
    };
  }

  private async createAuthSession(profileId: string, companyId?: string | null) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: profileId },
      include: { users: true },
    });

    if (!profile) throw new UnauthorizedException();

    const company = companyId ?? profile.company_id;
    const tokenVersion = this.getTokenVersion(profile.users?.raw_user_meta_data);
    const { accessToken, refreshToken } = await this.generateTokens(
      profile.id,
      profile.email,
      profile.role,
      company,
      tokenVersion,
    );

    await this.storeRefreshToken(profile.id, refreshToken);

    return {
      accessToken,
      refreshToken,
      user: await this.getSession({
        id: profile.id,
        role: profile.role,
        companyId: company,
      }),
    };
  }

  private async generateTokens(
    userId: string,
    email: string,
    userRole: role,
    companyId: string | null,
    tokenVersion: number,
  ) {
    const payload: AuthJwtPayload = {
      sub: userId,
      email,
      role: userRole,
      companyId,
      tokenVersion,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, { expiresIn: '12h' }),
      this.jwtService.signAsync(payload, { expiresIn: '7d' }),
    ]);

    return { accessToken, refreshToken };
  }

  private async generateSessionToken(userId: string, email: string) {
    const payload: SessionJwtPayload = {
      sub: userId,
      email,
      type: 'session',
    };

    return this.jwtService.signAsync(payload, { expiresIn: '10m' });
  }

  private generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private async createAndSendOtp(
    email: string,
    userName: string,
    otpCode?: string,
    expiresInMinutes = 30,
  ) {
    const code = otpCode ?? this.generateOtp();
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);
    const hashedCode = await bcrypt.hash(code, 10);

    // Store OTP in raw_user_meta_data on the users record (no separate table needed)
    await this.prisma.users.updateMany({
      where: { email },
      data: {
        raw_user_meta_data: {
          otp_code:       hashedCode,
          otp_expires_at: expiresAt.toISOString(),
        },
      },
    });

    const reservedDomains = ['.example', '.test', '.invalid', '.localhost'];
    const emailDomain = email.split('@')[1] || '';
    const isReservedDomain = reservedDomains.some(domain =>
      emailDomain.endsWith(domain),
    );

    try {
      await this.mailService.sendOtpEmail(email, code, userName, expiresInMinutes);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const isDevelopment = process.env.NODE_ENV !== 'production';

      if (isDevelopment) {
        console.log('\n===========================================');
        console.log('OTP CODE (Development Mode)');
        console.log('===========================================');
        console.log(`Email: ${email}`);
        console.log(`OTP Code: ${code}`);
        console.log(`Expires at: ${expiresAt.toISOString()}`);
        console.log('===========================================\n');

        if (isReservedDomain || errorMessage.includes('RFC 2606')) {
          console.warn(
            'Warning: Email domain is reserved (RFC 2606). OTP logged to console for development.',
          );
        }
        return;
      }

      await this.clearOtp(email);

      if (isReservedDomain || errorMessage.includes('RFC 2606')) {
        throw new BadRequestException(
          'Invalid email address: The email domain is reserved for testing purposes.',
        );
      }

      throw new BadRequestException(
        `Failed to send verification code: ${errorMessage}`,
      );
    }
  }

  private async verifyStoredOtp(email: string, otpCode: string) {
    const user = await this.prisma.users.findFirst({
      where: { email, deleted_at: null },
      select: { raw_user_meta_data: true },
    });

    const meta = user?.raw_user_meta_data as Record<string, string> | null;
    if (!meta?.otp_code || !meta?.otp_expires_at) {
      return false;
    }

    if (new Date(meta.otp_expires_at) <= new Date()) {
      return false;
    }

    return bcrypt.compare(otpCode, meta.otp_code);
  }

  private async assertValidOtp(email: string, otpCode: string) {
    const user = await this.prisma.users.findFirst({
      where: { email, deleted_at: null },
      select: { raw_user_meta_data: true },
    });

    const meta = user?.raw_user_meta_data as Record<string, string> | null;

    if (!meta?.otp_code) {
      throw new UnauthorizedException(
        'No verification code found. Sign in with your password to receive a new code.',
      );
    }

    if (new Date(meta.otp_expires_at) <= new Date()) {
      throw new UnauthorizedException(
        'Verification code has expired. Sign in with your password to receive a new code.',
      );
    }

    const isValid = await bcrypt.compare(otpCode, meta.otp_code);
    if (!isValid) {
      throw new UnauthorizedException(
        'Invalid verification code. Please check and try again.',
      );
    }
  }

  private async clearOtp(email: string) {
    await this.prisma.users.updateMany({
      where: { email },
      data: {
        raw_user_meta_data: {
          otp_code:       null,
          otp_expires_at: null,
        },
      },
    });
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

  private async storeRefreshToken(userId: string, refreshToken: string) {
    const hashedToken = await bcrypt.hash(refreshToken, 10);
    await this.prisma.refresh_tokens.create({
      data: {
        token: hashedToken,
        user_id: userId,
        revoked: false,
      },
    });
  }

  private async verifyStoredRefreshToken(userId: string, refreshToken: string) {
    const tokens = await this.prisma.refresh_tokens.findMany({
      where: { user_id: userId, revoked: { not: true } },
      orderBy: { updated_at: 'desc' },
      take: 10,
    });

    for (const storedToken of tokens) {
      if (storedToken.token && (await bcrypt.compare(refreshToken, storedToken.token))) {
        return true;
      }
    }

    return false;
  }

  private async revokeRefreshTokens(userId: string) {
    await this.prisma.refresh_tokens.updateMany({
      where: { user_id: userId, revoked: { not: true } },
      data: { revoked: true },
    });
  }

  private buildAuthUser(user: {
    id: string;
    email: string | null;
    profile?: {
      first_name: string;
      last_name: string;
      role: role;
      company_id: string | null;
      is_email_verified: boolean;
    } | null;
  }) {
    return {
      id: user.id,
      email: user.email,
      firstName: user.profile?.first_name ?? null,
      lastName: user.profile?.last_name ?? null,
      role: user.profile?.role ?? role.admin,
      companyId: user.profile?.company_id ?? null,
      isEmailVerified: user.profile?.is_email_verified ?? false,
    };
  }
}
