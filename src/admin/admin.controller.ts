import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.dto.js';
import { AdminService } from './admin.service.js';
import { InviteAdminDto } from './dto/invite-admin.dto.js';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto.js';
import { UpdatePaymentStatusDto } from './dto/update-payment-status.dto.js';
import { UpdateAdminRoleDto } from './dto/update-admin-role.dto.js';

interface AuthUser { id: string; role: role; }

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ── Super-admin only ────────────────────────────────────────────────────────

  @Post('invite')
  @Roles(role.super_admin)
  @ApiOperation({ summary: 'Super-admin: invite a new admin user' })
  inviteAdmin(
    @Body() dto: InviteAdminDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminService.inviteAdmin(dto, user.id);
  }

  @Get('admins')
  @Roles(role.super_admin)
  @ApiOperation({ summary: 'Super-admin: list all admin accounts' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page',   required: false, type: Number })
  @ApiQuery({ name: 'limit',  required: false, type: Number })
  listAdmins(
    @Query('search') search?: string,
    @Query('page',  new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
    @Query('limit', new DefaultValuePipe(6), ParseIntPipe) limit: number = 6,
  ) {
    return this.adminService.listAdmins({ search, page, limit });
  }

  @Patch('admins/:id/role')
  @Roles(role.super_admin)
  @ApiOperation({ summary: 'Super-admin: update an admin user role' })
  updateAdminRole(
    @Param('id') id: string,
    @Body() dto: UpdateAdminRoleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminService.updateAdminRole(id, dto, user.id);
  }

  @Delete('admins/:id')
  @Roles(role.super_admin)
  @ApiOperation({ summary: 'Super-admin: delete an admin user' })
  deleteAdmin(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminService.deleteAdmin(id, user.id);
  }

  @Get('activity')
  @Roles(role.super_admin)
  @ApiOperation({ summary: 'Super-admin: view admin activity log' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getActivity(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.adminService.getActivityLog(limit);
  }

  @Patch('attendees/:id/soft-delete')
  @Roles(role.admin, role.super_admin)
  @ApiOperation({ summary: 'Archive (soft-delete) an attendee' })
  softDeleteAttendee(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminService.softDeleteAttendee(id, user.id);
  }

  @Delete('attendees/:id')
  @Roles(role.super_admin)
  @ApiOperation({ summary: 'Super-admin: delete an attendee' })
  deleteAttendee(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminService.deleteAttendee(id, user.id);
  }

  // ── Admin + super-admin ─────────────────────────────────────────────────────

  @Get('stats')
  @Roles(role.admin, role.super_admin)
  @ApiOperation({ summary: 'Dashboard stats: order and payment counts' })
  getStats() {
    return this.adminService.getDashboardStats();
  }

  @Get('orders')
  @Roles(role.admin, role.super_admin)
  @ApiOperation({ summary: 'List all orders with pagination and filters' })
  @ApiQuery({ name: 'status',  required: false })
  @ApiQuery({ name: 'search',  required: false })
  @ApiQuery({ name: 'page',    required: false, type: Number })
  @ApiQuery({ name: 'limit',   required: false, type: Number })
  getOrders(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page:  number = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number = 20,
  ) {
    return this.adminService.getOrders({ status, search, page, limit });
  }

  @Get('orders/:id')
  @Roles(role.admin, role.super_admin)
  @ApiOperation({ summary: 'Get a single order by ID' })
  getOrder(@Param('id') id: string) {
    return this.adminService.getOrderById(id);
  }

  @Patch('orders/:id/status')
  @Roles(role.admin, role.super_admin)
  @ApiOperation({ summary: 'Update order status' })
  updateOrderStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminService.updateOrderStatus(id, dto, user.id);
  }

  @Patch('orders/:id/soft-delete')
  @Roles(role.admin, role.super_admin)
  @ApiOperation({ summary: 'Archive (soft-delete) an order' })
  softDeleteOrder(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminService.softDeleteOrder(id, user.id);
  }

  @Delete('orders/:id')
  @Roles(role.super_admin)
  @ApiOperation({ summary: 'Super-admin: delete an order' })
  deleteOrder(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminService.deleteOrder(id, user.id);
  }

  @Get('payments')
  @Roles(role.admin, role.super_admin)
  @ApiOperation({ summary: 'List all payment transactions' })
  @ApiQuery({ name: 'status',  required: false })
  @ApiQuery({ name: 'search',  required: false })
  @ApiQuery({ name: 'page',    required: false, type: Number })
  @ApiQuery({ name: 'limit',   required: false, type: Number })
  getPayments(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page:  number = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number = 20,
  ) {
    return this.adminService.getPayments({ status, search, page, limit });
  }

  @Get('payments/:id')
  @Roles(role.admin, role.super_admin)
  @ApiOperation({ summary: 'Get a single payment by ID' })
  getPayment(@Param('id') id: string) {
    return this.adminService.getPaymentById(id);
  }

  @Patch('payments/:id/status')
  @Roles(role.admin, role.super_admin)
  @ApiOperation({ summary: 'Update payment status' })
  updatePaymentStatus(
    @Param('id') id: string,
    @Body() dto: UpdatePaymentStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminService.updatePaymentStatus(id, dto, user.id);
  }

  @Patch('payments/:id/soft-delete')
  @Roles(role.admin, role.super_admin)
  @ApiOperation({ summary: 'Archive (soft-delete) a payment' })
  softDeletePayment(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminService.softDeletePayment(id, user.id);
  }

  @Delete('payments/:id')
  @Roles(role.super_admin)
  @ApiOperation({ summary: 'Super-admin: delete a payment' })
  deletePayment(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminService.deletePayment(id, user.id);
  }

  @Get('attendees')
  @Roles(role.admin, role.super_admin)
  @ApiOperation({ summary: 'List all attendees' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page',   required: false, type: Number })
  @ApiQuery({ name: 'limit',  required: false, type: Number })
  getAttendees(
    @Query('search') search?: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page:  number = 1,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number = 20,
  ) {
    return this.adminService.getAttendees({ search, page, limit });
  }
}
