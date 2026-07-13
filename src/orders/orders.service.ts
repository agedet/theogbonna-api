import {
  Injectable,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { UploadService } from '../upload/upload.service.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { DeliveryOption, OrderStatus } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import { randomUUID } from 'crypto';

const UNIT_PRICE_GBP = 100;
const HOST_PHONE     = '2347065606131'; // WhatsApp host number (no +)
const HOST_EMAIL     = process.env.HOST_EMAIL ?? process.env.MAIL_USER ?? '';

/** Flat delivery surcharges in GBP */
const DELIVERY_FEES: Record<DeliveryOption, number> = {
  [DeliveryOption.PICKUP]: 0,
  [DeliveryOption.LAGOS]:  10,
  [DeliveryOption.ABUJA]:  10,
  [DeliveryOption.PORT_HARCOURT]: 6,
  [DeliveryOption.ENUGU]:  6,
  [DeliveryOption.ONITSHA]: 6,
  [DeliveryOption.OTHER]:  10,
};

function deliveryLabel(opt: DeliveryOption): string {
  if (opt === DeliveryOption.PICKUP) return 'Will Pickup (no delivery fee)';
  return opt.replace(/_/g, ' ');
}

@Injectable()
export class OrdersService {
  private readonly mailer: nodemailer.Transporter;

  constructor(
    private readonly prisma:  PrismaService,
    private readonly upload:  UploadService,
  ) {
    this.mailer = nodemailer.createTransport({
      host:   process.env.MAIL_HOST,
      port:   Number(process.env.MAIL_PORT),
      secure: process.env.MAIL_SECURE === 'true',
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASSWORD,
      },
    });
  }

  // ── Create order ────────────────────────────────────────────────────────────

  async create(dto: CreateOrderDto) {
    if (dto.paymentRef) {
      const existing = await this.prisma.order.findUnique({
        where: { paymentRef: dto.paymentRef },
      });
      if (existing) {
        throw new ConflictException('This payment reference has already been used.');
      }
    }

    const deliveryFee = DELIVERY_FEES[dto.deliveryOption] ?? 0;
    const totalPrice  = dto.quantity * UNIT_PRICE_GBP + deliveryFee;

    // Upsert Attendee by email so re-orders are linked to the same record
    const [firstName, ...rest] = dto.fullName.trim().split(' ');
    const lastName = rest.join(' ') || firstName;

    try {
      // Create or update the attendee record
      const attendee = await this.prisma.attendee.upsert({
        where:  { email: dto.email },
        update: {
          firstName,
          lastName,
        },
        create: {
          firstName,
          lastName,
          email:           dto.email,
          dob:             new Date('1900-01-01'), // placeholder — no DOB in order form
          city:            '',
          state:           dto.deliveryState  ?? '',
          country:         'Nigeria',
          deliveryAddress: dto.deliveryAddress ?? '',
        },
      });

      const order = await this.prisma.order.create({
        data: {
          fullName:        dto.fullName,
          email:           dto.email,
          phone:           dto.phone,
          whatsapp:        dto.whatsapp,
          quantity:        dto.quantity,
          unitPrice:       UNIT_PRICE_GBP,
          totalPrice,
          deliveryOption:  dto.deliveryOption,
          deliveryAddress: dto.deliveryAddress,
          deliveryState:   dto.deliveryState,
          paymentRef:      dto.paymentRef,
          attendeeId:      attendee.id,
        },
      });

      this.sendOrderReceivedEmail(order).catch(console.error);
      this.sendAdminOrderEmail(order).catch(console.error);

      return {
        id:          order.id,
        totalPrice:  order.totalPrice,
        deliveryFee,
        status:      order.status,
        message:     'Order received. Upload your receipt in the next step.',
      };
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException('Duplicate entry detected.');
      }
      throw new InternalServerErrorException('Failed to create order.');
    }
  }

  // ── Upload receipt ──────────────────────────────────────────────────────────

  async attachReceipt(params: {
    orderId:  string;
    buffer:   Buffer;
    mimetype: string;
    filename: string;
  }) {
    const order = await this.prisma.order.findUnique({
      where:   { id: params.orderId },
      include: { attendee: true },
    });

    if (!order) {
      throw new NotFoundException(`Order ${params.orderId} not found.`);
    }

    // Upload file to Cloudinary — returns secure public URL
    const receiptUrl = await this.upload.uploadReceipt({
      buffer:   params.buffer,
      mimetype: params.mimetype,
      filename: params.filename,
      orderId:  params.orderId,
      fullName: order.fullName,
    });

    // Persist the Drive URL and mark the order as CONFIRMED
    const updated = await this.prisma.order.update({
      where: { id: params.orderId },
      data:  {
        receiptUrl,
        status: OrderStatus.CONFIRMED,
      },
      include: { attendee: true },
    });

    // Create a Transaction record tied to both attendee and order
    if (order.attendeeId) {
      await this.prisma.transaction.create({
        data: {
          attendeeId: order.attendeeId,
          orderId:    order.id,
          amount:     order.totalPrice,
          currency:   'GBP',
          reference:  order.paymentRef ?? `REF-${randomUUID()}`,
          status:     'SUCCESS',
          receiptUrl,
        },
      });
    }

    // Emails — fire and forget
    this.sendReceiptConfirmationEmail(updated, receiptUrl).catch(console.error);
    this.sendHostReceiptEmail(updated, receiptUrl).catch(console.error);

    return {
      orderId:    updated.id,
      receiptUrl,
      status:     updated.status,
      message:    'Receipt uploaded. Your order is now being verified.',
      whatsappUrl: this.buildWhatsAppUrl(updated),
    };
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  async findAll() {
    return this.prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      include: { attendee: true, transactions: true },
    });
  }

  async findOne(id: string) {
    return this.prisma.order.findUnique({
      where:   { id },
      include: { attendee: true, transactions: true },
    });
  }

  // ── WhatsApp URL builder ────────────────────────────────────────────────────

  buildWhatsAppUrl(order: {
    id:             string;
    fullName:       string;
    email:          string;
    phone:          string;
    quantity:       number;
    totalPrice:     number;
    deliveryOption: DeliveryOption;
    deliveryAddress: string | null;
    deliveryState:  string | null;
    paymentRef:     string | null;
    receiptUrl:     string | null;
  }): string {
    const lines = [
      `*Ogbonna Memorial — Asoebi Order Submission*`,
      ``,
      `*Order ID:* ${order.id}`,
      `*Name:* ${order.fullName}`,
      `*Email:* ${order.email}`,
      `*Phone:* ${order.phone}`,
      `*Quantity:* ${order.quantity} set(s)`,
      `*Total:* £${order.totalPrice}`,
      `*Delivery:* ${deliveryLabel(order.deliveryOption)}`,
      order.deliveryAddress ? `*Address:* ${order.deliveryAddress}, ${order.deliveryState ?? ''}` : null,
      order.paymentRef      ? `*Payment Ref:* ${order.paymentRef}` : null,
      order.receiptUrl      ? `*Receipt:* ${order.receiptUrl}` : null,
    ].filter(Boolean).join('\n');

    return `https://wa.me/${HOST_PHONE}?text=${encodeURIComponent(lines)}`;
  }

  // ── Emails ──────────────────────────────────────────────────────────────────

  /** Sent to buyer immediately after order is placed (Step 3 submit) */
  private async sendOrderReceivedEmail(order: {
    id: string; fullName: string; email: string;
    quantity: number; totalPrice: number;
    deliveryOption: DeliveryOption; paymentRef: string | null;
  }) {
    await this.mailer.sendMail({
      from:    process.env.MAIL_FROM,
      to:      order.email,
      subject: 'Ogbonna Memorial — Asoebi Order Received',
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:auto;color:#1e293b">
          <h2 style="color:#d97706">Thank you, ${order.fullName}</h2>
          <p>Your asoebi order has been received. Here is your summary:</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0"><b>Order ID</b></td><td style="padding:8px;border-bottom:1px solid #e2e8f0">${order.id}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0"><b>Quantity</b></td><td style="padding:8px;border-bottom:1px solid #e2e8f0">${order.quantity} set(s)</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0"><b>Total</b></td><td style="padding:8px;border-bottom:1px solid #e2e8f0;color:#d97706"><b>£${order.totalPrice}</b></td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0"><b>Delivery</b></td><td style="padding:8px;border-bottom:1px solid #e2e8f0">${deliveryLabel(order.deliveryOption)}</td></tr>
            ${order.paymentRef ? `<tr><td style="padding:8px"><b>Payment Ref</b></td><td style="padding:8px">${order.paymentRef}</td></tr>` : ''}
          </table>
          <p style="background:#fef9c3;padding:12px;border-radius:8px;color:#92400e">
            <b>Next step:</b> Please upload your payment receipt to complete your order.
            Transfer £${order.totalPrice} to:<br/>
            <b>Account Name:</b> Elizabeth Onyechere (Ogbonnas Memorial)<br/>
            <b>Account No.:</b> 2122454891<br/>
            <b>Bank:</b> Zenith Bank
          </p>
          <p style="color:#64748b;font-size:13px">For enquiries reply to this email.</p>
        </div>`,
    });
  }

  /** Sent to the host immediately after order is placed */
  private async sendAdminOrderEmail(order: {
    id: string; fullName: string; email: string; phone: string;
    quantity: number; totalPrice: number;
    deliveryOption: DeliveryOption; paymentRef: string | null;
  }) {
    await this.mailer.sendMail({
      from:    process.env.MAIL_FROM,
      to:      HOST_EMAIL,
      subject: `New Asoebi Order — ${order.fullName}`,
      html: `
        <div style="font-family:sans-serif;color:#1e293b">
          <h3 style="color:#d97706">New order received — receipt pending</h3>
          <p><b>ID:</b> ${order.id}</p>
          <p><b>Name:</b> ${order.fullName}</p>
          <p><b>Email:</b> ${order.email}</p>
          <p><b>Phone:</b> ${order.phone}</p>
          <p><b>Quantity:</b> ${order.quantity}</p>
          <p><b>Total:</b> £${order.totalPrice}</p>
          <p><b>Delivery:</b> ${deliveryLabel(order.deliveryOption)}</p>
          <p><b>Payment Ref:</b> ${order.paymentRef ?? 'Not yet provided'}</p>
          <p style="color:#64748b;font-size:13px">Receipt upload pending — you will receive another email once the buyer uploads proof of payment.</p>
        </div>`,
    });
  }

  /** Sent to buyer after they upload their receipt (Step 4 complete) */
  private async sendReceiptConfirmationEmail(order: {
    id: string; fullName: string; email: string;
    quantity: number; totalPrice: number;
    deliveryOption: DeliveryOption;
  }, receiptUrl: string) {
    await this.mailer.sendMail({
      from:    process.env.MAIL_FROM,
      to:      order.email,
      subject: 'Ogbonna Memorial — Receipt Received, Order Being Verified',
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:auto;color:#1e293b">
          <h2 style="color:#16a34a">✅ Receipt received!</h2>
          <p>Hi ${order.fullName}, your payment receipt has been successfully submitted.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0"><b>Order ID</b></td><td style="padding:8px;border-bottom:1px solid #e2e8f0">${order.id}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0"><b>Quantity</b></td><td style="padding:8px;border-bottom:1px solid #e2e8f0">${order.quantity} set(s)</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0"><b>Total Paid</b></td><td style="padding:8px;border-bottom:1px solid #e2e8f0;color:#16a34a"><b>£${order.totalPrice}</b></td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0"><b>Delivery</b></td><td style="padding:8px;border-bottom:1px solid #e2e8f0">${deliveryLabel(order.deliveryOption)}</td></tr>
            <tr><td style="padding:8px"><b>Receipt</b></td><td style="padding:8px"><a href="${receiptUrl}" style="color:#2563eb">View uploaded receipt</a></td></tr>
          </table>
          <p style="background:#dcfce7;padding:12px;border-radius:8px;color:#166534">
            Your order is now <b>being verified</b>. We will contact you once payment is confirmed and your materials are ready.
          </p>
          <p style="color:#64748b;font-size:13px">For enquiries reply to this email or WhatsApp +2347065606131.</p>
        </div>`,
    });
  }

  /** Sent to the host after buyer uploads their receipt */
  private async sendHostReceiptEmail(order: {
    id: string; fullName: string; email: string; phone: string;
    quantity: number; totalPrice: number;
    deliveryOption: DeliveryOption;
    deliveryAddress: string | null; deliveryState: string | null;
    paymentRef: string | null;
  }, receiptUrl: string) {
    await this.mailer.sendMail({
      from:    process.env.MAIL_FROM,
      to:      HOST_EMAIL,
      subject: `🧾 Receipt Uploaded — ${order.fullName} (Order ${order.id})`,
      html: `
        <div style="font-family:sans-serif;color:#1e293b">
          <h3 style="color:#2563eb">Receipt uploaded — action required</h3>
          <p>A buyer has uploaded their payment receipt. Please verify and confirm their order.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0"><b>Order ID</b></td><td style="padding:8px;border-bottom:1px solid #e2e8f0">${order.id}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0"><b>Name</b></td><td style="padding:8px;border-bottom:1px solid #e2e8f0">${order.fullName}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0"><b>Email</b></td><td style="padding:8px;border-bottom:1px solid #e2e8f0">${order.email}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0"><b>Phone</b></td><td style="padding:8px;border-bottom:1px solid #e2e8f0">${order.phone}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0"><b>Quantity</b></td><td style="padding:8px;border-bottom:1px solid #e2e8f0">${order.quantity} set(s)</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0"><b>Total</b></td><td style="padding:8px;border-bottom:1px solid #e2e8f0"><b>£${order.totalPrice}</b></td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0"><b>Delivery</b></td><td style="padding:8px;border-bottom:1px solid #e2e8f0">${deliveryLabel(order.deliveryOption)}</td></tr>
            ${order.deliveryAddress ? `<tr><td style="padding:8px;border-bottom:1px solid #e2e8f0"><b>Address</b></td><td style="padding:8px;border-bottom:1px solid #e2e8f0">${order.deliveryAddress}, ${order.deliveryState ?? ''}</td></tr>` : ''}
            ${order.paymentRef      ? `<tr><td style="padding:8px;border-bottom:1px solid #e2e8f0"><b>Payment Ref</b></td><td style="padding:8px;border-bottom:1px solid #e2e8f0">${order.paymentRef}</td></tr>` : ''}
            <tr><td style="padding:8px"><b>Receipt</b></td><td style="padding:8px"><a href="${receiptUrl}" style="color:#2563eb;font-weight:bold">Open Receipt in Drive</a></td></tr>
          </table>
        </div>`,
    });
  }
}
