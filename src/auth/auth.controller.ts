import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService, AuthUserPayload } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CookieService } from './services/cookie.service';
import { ConfigService } from '@nestjs/config';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { VerifyForgotPasswordOtpDto } from './dto/verify-forgot-password-otp.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { CurrentUser } from '../common/decorators/current-user.dto.js';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly cookieService: CookieService,
    private readonly configService: ConfigService,
  ) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('verify-registration')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify registration OTP' })
  async verifyRegistration(@Body() body: { email: string; token: string }) {
    return this.authService.verifyRegistration(body.email, body.token);
  }

  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend OTP for registration, login, or password reset' })
  async resendOtp(@Body() dto: ResendOtpDto) {
    return this.authService.resendOtp(dto);
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify OTP - Step 2: Complete login' })
  @ApiResponse({
    status: 200,
    description: 'OTP verified, user logged in successfully',
  })
  @ApiResponse({ status: 401, description: 'Invalid or expired OTP' })
  async verifyOtp(
    @Body() verifyOtpDto: VerifyOtpDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
  ) {
    // Fallback: Use raw body if DTO is empty (in case ValidationPipe stripped it)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const sessionToken = verifyOtpDto?.sessionToken || req.body?.sessionToken;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const otpCode = verifyOtpDto?.otpCode || req.body?.otpCode;

    if (!sessionToken || !otpCode) {
      throw new BadRequestException(
        'Session token and OTP code are required. Received: ' +
          JSON.stringify({ sessionToken: !!sessionToken, otpCode: !!otpCode }),
      );
    }

    // Step 2: Verify OTP and complete login
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const result = await this.authService.verifyOtp(sessionToken, otpCode);

    // Set cookies using request-aware options
    this.cookieService.setAccessTokenCookie(res, result.accessToken, req);
    this.cookieService.setRefreshTokenCookie(res, result.refreshToken, req);

    // Return response WITHOUT tokens (they're in cookies)
    return {
      user: result.user,
    };
  }

  @Post('login')
  @UseGuards(LocalAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login user - Step 1: Get session token and OTP' })
  @ApiResponse({
    status: 200,
    description: 'Session token returned, OTP sent to email',
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() loginDto: LoginDto, @CurrentUser() user: any) {
    try {
      const result = await this.authService.login(user);

      return {
        sessionToken: result.sessionToken,
        message: result.message,
        requiresTwoFactor: result.requiresTwoFactor,
        requiresEmailVerification: result.requiresEmailVerification,
        email: result.email,
      };
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout user' })
  @ApiResponse({ status: 200, description: 'User successfully logged out' })
  async logout(
    @CurrentUser() user: any,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    // Clear refresh token from database
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
    await this.authService.logout(user.id);

    // Clear all authentication cookies
    this.cookieService.clearAllAuthCookies(res, req);

    // Optional: Log logout activity
    if (user?.id) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      console.log(`User ${user.id} logged out`);
    }

    return { message: 'Logout successful' };
  }

//   @UseGuards(JwtAuthGuard)
//   @Post('onboarding')
//   async onboarding(
//     @Req() req: Request,
//     @Body() dto: OnboardingDto,
//     @Res({ passthrough: true }) res: Response,
//   ) {
//     const session = await this.authService.completeOnboarding(
//       req.user as AuthUserPayload,
//       dto,
//     );
//     this.cookieService.setAccessTokenCookie(res, session.accessToken, req);
//     this.cookieService.setRefreshTokenCookie(res, session.refreshToken, req);
//     return {
//       message: 'Onboarding completed successfully',
//       user: session.user,
//     };
//   }

  @UseGuards(JwtAuthGuard)
  @Get('session')
  getSession(@Req() req: Request) {
    return this.authService.getSession(req.user as AuthUserPayload);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid refresh token' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Get refresh token from cookie only (security: not from request body)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token not found');
    }

    // Generate new tokens
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const result = await this.authService.refreshToken(refreshToken);

    // Set new cookies
    this.cookieService.setAccessTokenCookie(res, result.accessToken, req);
    this.cookieService.setRefreshTokenCookie(res, result.refreshToken, req);

    // Return response
    return {
      user: result.user,
    };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user profile' })
  @ApiResponse({ status: 200, description: 'User profile retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getCurrentUser(@CurrentUser() user: any) {
    // Fetch full user details from database
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
    const fullUser = await this.authService.getUserProfile(user.id);

    // Return sanitized user data
    return {
      id: fullUser.id,
      email: fullUser.email,
      username: fullUser.username,
      firstName: fullUser.firstName,
      lastName: fullUser.lastName,
      role: fullUser.role,
      permissions: fullUser.permissions,
      isGoogleUser: fullUser.isGoogleUser,
      picture: fullUser.picture,
    };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Forgot password - Step 1: Request password reset OTP',
  })
  @ApiResponse({
    status: 200,
    description:
      'If an account with that email exists, a password reset code has been sent.',
  })
  @ApiResponse({ status: 400, description: 'Invalid email address' })
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  @Post('verify-forgot-password-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Verify forgot password OTP - Step 2a: Verify OTP before resetting password',
  })
  @ApiResponse({
    status: 200,
    description: 'OTP verified successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid email',
  })
  @ApiResponse({ status: 401, description: 'Invalid or expired OTP code' })
  async verifyForgotPasswordOtp(
    @Body() verifyOtpDto: VerifyForgotPasswordOtpDto,
  ) {
    return this.authService.verifyForgotPasswordOtp(
      verifyOtpDto.email,
      verifyOtpDto.otpCode,
    );
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reset password - Step 2: Verify OTP and set new password',
  })
  @ApiResponse({
    status: 200,
    description: 'Password reset successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid email, OTP, or passwords do not match',
  })
  @ApiResponse({ status: 401, description: 'Invalid or expired OTP code' })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword( resetPasswordDto );
  }

  @Post('setup-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set up password with invitation token (one-time use)',
  })
  @ApiResponse({
    status: 200,
    description: 'Password set up successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid token, expired, or already used',
  })
  async setupPasswordWithInvitation(
    @Body()
    body: {
      invitationToken: string;
      newPassword: string;
      confirmPassword: string;
    },
  ) {
    return this.authService.setupPasswordWithInvitation(
      body.invitationToken,
      body.newPassword,
      body.confirmPassword,
    );
  }

  @Get('verify-invitation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify invitation token validity',
  })
  @ApiQuery({ name: 'token', required: true, description: 'Invitation token' })
  @ApiResponse({
    status: 200,
    description: 'Token is valid',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or expired token',
  })
  async verifyInvitationToken(@Query('token') token: string) {
    return this.authService.verifyInvitationToken(token);
  }
}
