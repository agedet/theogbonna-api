import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InviteAdminDto {
  @ApiProperty({ example: 'admin@ogbonnamemorial.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Chukwuemeka' })
  @IsString()
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ example: 'Ogbonna' })
  @IsString()
  @MaxLength(100)
  lastName: string;

  @ApiPropertyOptional({ example: 'Lead Admin' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  jobTitle?: string;
}
