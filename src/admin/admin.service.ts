import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { MailService } from '../mail/mail.service.js';
import { ConfigService } from '@nestjs/config';
import { InviteAdminDto } from './dto/invite-admin.dto.js';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto.js';
import { UpdatePaymentStatusDto } from './dto/update-payment-status.dto.js';
import { UpdateAdminRoleDto } from './dto/update-admin-role.dto.js';
import { order_status, role } from '@prisma/client';
import { randomUUID } from 'crypto';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: DatabaseService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  // ── Super-admin: invite a new admin ────────────────────────────────────────

  async inviteAdmin(dto: InviteAdminDto, invitedByUserId: string) {
    const email = dto.email.toLowerCase().trim();

    // Check if already exists
    const existing = await this.prisma.profile.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('A user with this email already exists.');
    }

    // Use recovery_token field — consistent with setupPasswordWithInvitation in auth.service.ts
    const rawToken  = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days (matches verifyInvitationToken)

    const userId = randomUUID();

    // Create auth.users record — no password yet, admin sets it via the invitation link
    await this.prisma.users.create({
      data: {
        id:                userId,
        email,
        instance_id:       '00000000-0000-0000-0000-000000000000',
        is_anonymous:      false,
        invited_at:        new Date(),
        // recovery_token + recovery_sent_at is the pattern already used by
        // setupPasswordWithInvitation / verifyInvitationToken in auth.service.ts
        recovery_token:    rawToken,
        recovery_sent_at:  new Date(),
        raw_user_meta_data: { tokenVersion: 0 },
        profile: {
          create: {
            email,
            first_name: dto.firstName.trim(),
            last_name:  dto.lastName.trim(),
            job_title:  dto.jobTitle?.trim() ?? null,
            role:       role.admin,
          },
        },
      },
    });

    // Log the activity
    await this.prisma.admin_activity_log.create({
      data: {
        user_id:       invitedByUserId,
        activity:      `Invited admin: ${email}`,
        activity_type: 'ADMIN_INVITE',
        details:       `${dto.firstName} ${dto.lastName} (${email}) invited as admin`,
        metadata:      { invitedEmail: email, role: 'admin' },
      },
    });

    // Build invitation link
    const frontendUrl = this.configService.get<string>('clientAppBaseUrl') ?? 'http://localhost:5173';
    const invitationLink = `${frontendUrl}/admin/auth/setup-password?token=${rawToken}&email=${encodeURIComponent(email)}`;

    // Send invitation email
    await this.mailService.sendUserInvitationEmail(
      email,
      'admin',
      invitationLink,
      dto.firstName,
      'Super Admin',
    );

    this.logger.log(`Admin invitation sent to ${email}`);

    return {
      message: `Invitation sent to ${email}. They will receive an email to set up their account.`,
      email,
    };
  }

  // ── List all admins (super-admin only) ─────────────────────────────────────

  async listAdmins(filters: {
    search?: string;
    page?: number;
    limit?: number;
  } = {}) {
    const page  = Math.max(1, filters.page  ?? 1);
    const limit = Math.min(100, filters.limit ?? 6);
    const skip  = (page - 1) * limit;

    const where: Record<string, unknown> = {
      role: { in: [role.admin, role.super_admin] },
      users: { deleted_at: null },
    };

    if (filters.search) {
      where.OR = [
        { email:      { contains: filters.search, mode: 'insensitive' } },
        { first_name: { contains: filters.search, mode: 'insensitive' } },
        { last_name:  { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [profiles, total] = await Promise.all([
      this.prisma.profile.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
        select: {
          id:         true,
          email:      true,
          first_name: true,
          last_name:  true,
          job_title:  true,
          role:       true,
          created_at: true,
          is_email_verified: true,
        },
      }),
      this.prisma.profile.count({ where }),
    ]);

    return {
      data: profiles.map(p => ({
        id:               p.id,
        email:            p.email,
        firstName:        p.first_name,
        lastName:         p.last_name,
        jobTitle:         p.job_title,
        role:             p.role,
        isEmailVerified:  p.is_email_verified,
        createdAt:        p.created_at,
      })),
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async updateAdminRole(
    targetUserId: string,
    dto: UpdateAdminRoleDto,
    actorUserId: string,
  ) {
    if (targetUserId === actorUserId) {
      throw new BadRequestException('You cannot change your own role.');
    }

    const profile = await this.prisma.profile.findFirst({
      where: { id: targetUserId, users: { deleted_at: null } },
    });
    if (!profile) throw new NotFoundException('User not found.');

    if (
      profile.role === role.super_admin &&
      dto.role !== role.super_admin
    ) {
      const superAdminCount = await this.prisma.profile.count({
        where: {
          role: role.super_admin,
          users: { deleted_at: null },
        },
      });
      if (superAdminCount <= 1) {
        throw new BadRequestException('Cannot demote the last super admin.');
      }
    }

    const updated = await this.prisma.profile.update({
      where: { id: targetUserId },
      data: { role: dto.role },
    });

    await this.prisma.admin_activity_log.create({
      data: {
        user_id:       actorUserId,
        activity:      `Updated user role: ${profile.email} → ${dto.role}`,
        activity_type: 'USER_ROLE_UPDATE',
        details:       `${profile.email} role changed from ${profile.role} to ${dto.role}`,
        metadata:      {
          targetUserId,
          previousRole: profile.role,
          newRole: dto.role,
        },
      },
    });

    return {
      id:              updated.id,
      email:           updated.email,
      firstName:       updated.first_name,
      lastName:        updated.last_name,
      jobTitle:        updated.job_title,
      role:            updated.role,
      isEmailVerified: updated.is_email_verified,
      createdAt:       updated.created_at,
    };
  }

  async deleteAdmin(targetUserId: string, actorUserId: string) {
    if (targetUserId === actorUserId) {
      throw new BadRequestException('You cannot delete your own account.');
    }

    const profile = await this.prisma.profile.findFirst({
      where: { id: targetUserId, users: { deleted_at: null } },
    });
    if (!profile) throw new NotFoundException('User not found.');

    if (profile.role === role.super_admin) {
      const superAdminCount = await this.prisma.profile.count({
        where: {
          role: role.super_admin,
          users: { deleted_at: null },
        },
      });
      if (superAdminCount <= 1) {
        throw new BadRequestException('Cannot delete the last super admin.');
      }
    }

    await this.prisma.$transaction([
      this.prisma.refresh_tokens.updateMany({
        where: { user_id: targetUserId, revoked: { not: true } },
        data: { revoked: true },
      }),
      this.prisma.users.update({
        where: { id: targetUserId },
        data: {
          deleted_at: new Date(),
          recovery_token: null,
          recovery_sent_at: null,
        },
      }),
    ]);

    await this.prisma.admin_activity_log.create({
      data: {
        user_id:       actorUserId,
        activity:      `Deleted admin: ${profile.email}`,
        activity_type: 'ADMIN_DELETE',
        details:       `${profile.first_name} ${profile.last_name} (${profile.email}) deleted`,
        metadata:      { targetUserId, email: profile.email, role: profile.role },
      },
    });

    return { message: `Admin ${profile.email} has been deleted.` };
  }

  // ── Orders (admin + super-admin) ────────────────────────────────────────────

  async getOrders(filters: {
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page  = Math.max(1, filters.page  ?? 1);
    const limit = Math.min(100, filters.limit ?? 20);
    const skip  = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.search) {
      where.OR = [
        { fullName:  { contains: filters.search, mode: 'insensitive' } },
        { email:     { contains: filters.search, mode: 'insensitive' } },
        { phone:     { contains: filters.search, mode: 'insensitive' } },
        { paymentRef:{ contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [orders, total] = await Promise.all([
      this.prisma.orders.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          attendees:    true,
          transactions: true,
        },
      }),
      this.prisma.orders.count({ where }),
    ]);

    return {
      data: orders,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async getOrderById(id: string) {
    const order = await this.prisma.orders.findUnique({
      where:   { id },
      include: { attendees: true, transactions: true },
    });

    if (!order) throw new NotFoundException(`Order ${id} not found.`);
    return order;
  }

  async updateOrderStatus(id: string, dto: UpdateOrderStatusDto, adminUserId: string) {
    const order = await this.prisma.orders.findUnique({
      where: { id },
      include: { transactions: true },
    });
    if (!order) throw new NotFoundException(`Order ${id} not found.`);

    const paymentStatus = this.paymentStatusForOrderStatus(dto.status, !!order.receiptUrl);

    const updated = await this.prisma.$transaction(async (tx) => {
      const nextOrder = await tx.orders.update({
        where: { id },
        data: { status: dto.status },
        include: { attendees: true, transactions: true },
      });

      if (paymentStatus) {
        await tx.transactions.updateMany({
          where: { orderId: id },
          data: { status: paymentStatus, updatedAt: new Date() },
        });
      }

      return nextOrder;
    });

    await this.prisma.admin_activity_log.create({
      data: {
        user_id:       adminUserId,
        activity:      `Updated order status: ${id} → ${dto.status}`,
        activity_type: 'ORDER_STATUS_UPDATE',
        details:       `Order ${id} status changed to ${dto.status}${
          paymentStatus ? `; payment → ${paymentStatus}` : ''
        }`,
        metadata:      {
          orderId: id,
          newStatus: dto.status,
          paymentStatus,
        },
      },
    });

    return this.getOrderById(id);
  }

  /** Keep payment status aligned with the business rules for order status. */
  private paymentStatusForOrderStatus(
    status: string,
    hasReceipt: boolean,
  ): 'PENDING' | 'SUCCESS' | 'FAILED' | null {
    if (status === 'payment_verified') return 'SUCCESS';
    if (status === 'cancelled') return 'FAILED';
    if (
      status === 'awaiting_payment' ||
      status === 'payment_proof_received' ||
      status === 'new'
    ) {
      return 'PENDING';
    }
    // Other fulfilment statuses: leave payment alone unless never verified
    if (!hasReceipt) return 'PENDING';
    return null;
  }

  async deleteOrder(id: string, adminUserId: string) {
    const order = await this.prisma.orders.findUnique({ where: { id } });
    if (!order) throw new NotFoundException(`Order ${id} not found.`);

    await this.prisma.$transaction([
      this.prisma.transactions.deleteMany({ where: { orderId: id } }),
      this.prisma.orders.delete({ where: { id } }),
    ]);

    await this.prisma.admin_activity_log.create({
      data: {
        user_id:       adminUserId,
        activity:      `Deleted order: ${id}`,
        activity_type: 'ORDER_DELETE',
        details:       `Order for ${order.fullName} (${order.email}) deleted`,
        metadata:      { orderId: id, email: order.email },
      },
    });

    return { message: `Order ${id} has been deleted.` };
  }

  // ── Payments (transactions) ─────────────────────────────────────────────────

  async getPayments(filters: {
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page  = Math.max(1, filters.page  ?? 1);
    const limit = Math.min(100, filters.limit ?? 20);
    const skip  = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (filters.status) where.status = filters.status;

    if (filters.search) {
      where.OR = [
        { reference: { contains: filters.search, mode: 'insensitive' } },
        { attendees: { email: { contains: filters.search, mode: 'insensitive' } } },
      ];
    }

    const [transactions, total] = await Promise.all([
      this.prisma.transactions.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          attendees: { select: { firstName: true, lastName: true, email: true } },
          orders:    { select: { id: true, fullName: true, totalPrice: true, status: true, receiptUrl: true } },
        },
      }),
      this.prisma.transactions.count({ where }),
    ]);

    return {
      data: transactions,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async updatePaymentStatus(
    id: string,
    dto: UpdatePaymentStatusDto,
    adminUserId: string,
  ) {
    const txn = await this.prisma.transactions.findUnique({
      where: { id },
      include: { orders: true },
    });
    if (!txn) throw new NotFoundException(`Payment ${id} not found.`);

    const orderStatus = this.orderStatusForPaymentStatus(
      dto.status,
      !!txn.orders?.receiptUrl || !!txn.receiptUrl,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.transactions.update({
        where: { id },
        data: { status: dto.status, updatedAt: new Date() },
      });

      if (txn.orderId && orderStatus) {
        await tx.orders.update({
          where: { id: txn.orderId },
          data: { status: orderStatus },
        });
      }
    });

    await this.prisma.admin_activity_log.create({
      data: {
        user_id:       adminUserId,
        activity:      `Updated payment status: ${id} → ${dto.status}`,
        activity_type: 'PAYMENT_STATUS_UPDATE',
        details:       `Payment ${txn.reference} status changed to ${dto.status}${
          orderStatus ? `; order → ${orderStatus}` : ''
        }`,
        metadata:      {
          paymentId: id,
          reference: txn.reference,
          previousStatus: txn.status,
          newStatus: dto.status,
          orderStatus,
        },
      },
    });

    return this.getPaymentById(id);
  }

  private orderStatusForPaymentStatus(
    paymentStatus: string,
    hasReceipt: boolean,
  ): order_status | null {
    if (paymentStatus === 'SUCCESS') return order_status.payment_verified;
    if (paymentStatus === 'FAILED') return order_status.cancelled;
    if (paymentStatus === 'PENDING') {
      return hasReceipt
        ? order_status.payment_proof_received
        : order_status.awaiting_payment;
    }
    return null;
  }

  async getPaymentById(id: string) {
    const txn = await this.prisma.transactions.findUnique({
      where: { id },
      include: {
        attendees: true,
        orders: {
          include: { attendees: true, transactions: true },
        },
      },
    });
    if (!txn) throw new NotFoundException(`Payment ${id} not found.`);
    return txn;
  }

  async deletePayment(id: string, adminUserId: string) {
    const txn = await this.prisma.transactions.findUnique({ where: { id } });
    if (!txn) throw new NotFoundException(`Payment ${id} not found.`);

    await this.prisma.transactions.delete({ where: { id } });

    await this.prisma.admin_activity_log.create({
      data: {
        user_id:       adminUserId,
        activity:      `Deleted payment: ${txn.reference}`,
        activity_type: 'PAYMENT_DELETE',
        details:       `Payment ${txn.reference} (₦/${txn.currency} ${txn.amount}) deleted`,
        metadata:      {
          paymentId: id,
          reference: txn.reference,
          amount: txn.amount,
        },
      },
    });

    return { message: `Payment ${txn.reference} has been deleted.` };
  }

  // ── Attendees ───────────────────────────────────────────────────────────────

  async getAttendees(filters: {
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page  = Math.max(1, filters.page  ?? 1);
    const limit = Math.min(100, filters.limit ?? 20);
    const skip  = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (filters.search) {
      where.OR = [
        { firstName: { contains: filters.search, mode: 'insensitive' } },
        { lastName:  { contains: filters.search, mode: 'insensitive' } },
        { email:     { contains: filters.search, mode: 'insensitive' } },
        { city:      { contains: filters.search, mode: 'insensitive' } },
        { state:     { contains: filters.search, mode: 'insensitive' } },
        { country:   { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [attendees, total] = await Promise.all([
      this.prisma.attendees.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          _count: { select: { orders: true, transactions: true } },
        },
      }),
      this.prisma.attendees.count({ where }),
    ]);

    return {
      data: attendees,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async deleteAttendee(id: string, adminUserId: string) {
    const attendee = await this.prisma.attendees.findUnique({ where: { id } });
    if (!attendee) throw new NotFoundException(`Attendee ${id} not found.`);

    await this.prisma.$transaction([
      this.prisma.transactions.deleteMany({ where: { attendeeId: id } }),
      this.prisma.orders.updateMany({
        where: { attendeeId: id },
        data: { attendeeId: null },
      }),
      this.prisma.attendees.delete({ where: { id } }),
    ]);

    await this.prisma.admin_activity_log.create({
      data: {
        user_id:       adminUserId,
        activity:      `Deleted attendee: ${attendee.email}`,
        activity_type: 'ATTENDEE_DELETE',
        details:       `${attendee.firstName} ${attendee.lastName} (${attendee.email}) deleted`,
        metadata:      { attendeeId: id, email: attendee.email },
      },
    });

    return { message: `Attendee ${attendee.email} has been deleted.` };
  }

  // ── Activity log ────────────────────────────────────────────────────────────

  async getActivityLog(limit = 50) {
    return this.prisma.admin_activity_log.findMany({
      orderBy: { created_at: 'desc' },
      take: limit,
      include: {
        user: {
          select: { email: true, profile: { select: { first_name: true, last_name: true } } },
        },
      },
    });
  }

  // ── Dashboard stats ─────────────────────────────────────────────────────────

  async getDashboardStats() {
    const [
      totalOrders,
      pendingOrders,
      confirmedOrders,
      totalTransactions,
      pendingTransactions,
      successTransactions,
    ] = await Promise.all([
      this.prisma.orders.count(),
      this.prisma.orders.count({
        where: {
          status: {
            in: [
              order_status.new,
              order_status.awaiting_payment,
              order_status.payment_proof_received,
            ],
          },
        },
      }),
      this.prisma.orders.count({ where: { status: order_status.payment_verified } }),
      this.prisma.transactions.count(),
      this.prisma.transactions.count({ where: { status: 'PENDING' } }),
      this.prisma.transactions.count({ where: { status: 'SUCCESS' } }),
    ]);

    const revenue = await this.prisma.transactions.aggregate({
      where:  { status: 'SUCCESS' },
      _sum:   { amount: true },
    });

    return {
      orders: {
        total:     totalOrders,
        pending:   pendingOrders,
        confirmed: confirmedOrders,
      },
      payments: {
        total:   totalTransactions,
        pending: pendingTransactions,
        success: successTransactions,
        revenue: revenue._sum.amount ?? 0,
      },
    };
  }
}
