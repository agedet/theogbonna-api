import { Module } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './strategies/jwt.strategy.js';
import { LocalStrategy } from './strategies/local.strategy.js';
import { CookieService } from './services/cookie.service.js';
import { MailModule } from '../mail/mail.module.js';

@Module({
  imports: [
    PassportModule,
    MailModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('security.jwtSecret') ?? 'default-jwt-secret',
        signOptions: { expiresIn: '12h' },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, LocalStrategy, CookieService],
  // Export so AdminModule, UsersModule, and JwtStrategy consumers can use
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
