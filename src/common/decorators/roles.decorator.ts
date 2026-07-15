import { SetMetadata } from '@nestjs/common';
import { role } from '@prisma/client';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: role[]) => SetMetadata(ROLES_KEY, roles);