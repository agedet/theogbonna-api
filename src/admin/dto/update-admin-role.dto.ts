import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { role } from '@prisma/client';

export class UpdateAdminRoleDto {
  @ApiProperty({ enum: [role.admin, role.super_admin] })
  @IsEnum(role)
  role: role;
}
