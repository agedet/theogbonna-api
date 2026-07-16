import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { MailService } from '../mail/mail.service.js';
import { ConfigService } from '@nestjs/config';
import { InviteAdminDto } from './dto/invite-admin.dto.js';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto.js';
import { role } from '@prisma/client';
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

  async listAdmins() {
    const profiles = await this.prisma.profile.findMany({
      where: { role: { in: [role.admin, role.super_admin] } },
      orderBy: { created_at: 'desc' },
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
    });

    return profiles.map(p => ({
      id:               p.id,
      email:            p.email,
      firstName:        p.first_name,
      lastName:         p.last_name,
      jobTitle:         p.job_title,
      role:             p.role,
      isEmailVerified:  p.is_email_verified,
      createdAt:        p.created_at,
    }));
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
    const order = await this.prisma.orders.findUnique({ where: { id } });
    if (!order) throw new NotFoundException(`Order ${id} not found.`);

    const updated = await this.prisma.orders.update({
      where: { id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data:  { status: dto.status as any },
    });

    await this.prisma.admin_activity_log.create({
      data: {
        user_id:       adminUserId,
        activity:      `Updated order status: ${id} → ${dto.status}`,
        activity_type: 'ORDER_STATUS_UPDATE',
        details:       `Order ${id} status changed to ${dto.status}`,
        metadata:      { orderId: id, newStatus: dto.status },
      },
    });

    return updated;
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
      this.prisma.orders.count({ where: { status: 'new' as any } }),
      this.prisma.orders.count({ where: { status: 'payment_verified' as any } }),
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
