import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';

export enum OtpPurpose {
  registration = 'registration',
  password_reset = 'password_reset',
  login = 'login',
}

export class ResendOtpDto {
  @ApiProperty({ example: 'user@example.com', required: false })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiProperty({ enum: OtpPurpose })
  @IsEnum(OtpPurpose)
  purpose: OtpPurpose;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  sessionToken?: string;
}
