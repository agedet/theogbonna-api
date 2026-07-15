import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'John', required: false })
  @IsString()
  @IsOptional()
  firstName: string;

  @ApiProperty({ example: 'Doe', required: false })
  @IsString()
  @IsOptional()
  lastName: string;

  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'johndoe', required: false })
  @IsString()
  @IsOptional()
  @MinLength(3)
  username?: string;

  @ApiProperty({ example: 'Password123', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: '+1234567890', required: false })
  @IsString()
  @IsOptional()
  phoneNumber: string;

  @ApiProperty({ example: 'New York', required: false })
  @IsString()
  @IsOptional()
  state: string;

  @ApiProperty({ example: 'USA', required: false })
  @IsString()
  @IsOptional()
  country: string;

  @ApiProperty({ example: '1990-01-01', required: false })
  @IsDateString()
  dateOfBirth: string;

  @ApiProperty({ description: 'Accept terms and conditions', required: true })
  @IsBoolean()
  termsAndConditions: boolean;
}
