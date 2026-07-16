import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles?.length) return true;

    const { user } = context.switchToHttp().getRequest<{
      user?: { role?: role | string };
    }>();

    if (!user?.role) {
      throw new ForbiddenException('Authenticated user role is missing');
    }

    if (user.role === role.super_admin || user.role === 'super_admin') {
      return true;
    }

    if (requiredRoles.includes(user.role as role)) {
      return true;
    }

    throw new ForbiddenException(
      'You do not have permission to perform this action',
    );
  }
}
