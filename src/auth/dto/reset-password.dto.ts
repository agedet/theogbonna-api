import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'OTP code sent to email' })
  @IsString()
  otpCode: string;

  @ApiProperty({ example: 'newPassword123', minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword: string;

  @ApiProperty({ example: 'newPassword123', minLength: 8 })
  @IsString()
  @MinLength(8)
  confirmPassword: string;
}