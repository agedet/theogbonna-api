import {
  Injectable,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { UploadService } from '../upload/upload.service.js';
import { MailService } from '../mail/mail.service.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { delivery_option, order_status } from '@prisma/client';
import { randomUUID } from 'crypto';

const UNIT_PRICE_GBP = 100;

/** Per-product unit prices in GBP */
const PRODUCT_PRICES: Record<string, number> = {
  WOMENS_ASOEBI: 100,
  MENS_ASOEBI:   10,
};
const HOST_PHONE     = '447958198281'; // WhatsApp host number (no +)
const HOST_EMAIL     = process.env.HOST_EMAIL ?? '';

/** Flat delivery surcharges in GBP */
const DELIVERY_FEES: Record<delivery_option, number> = {
  [delivery_option.PICKUP]: 0,
  [delivery_option.LAGOS]:  10,
  [delivery_option.ABUJA]:  10,
  [delivery_option.PORT_HARCOURT]: 6,
  [delivery_option.ENUGU]:  6,
  [delivery_option.ONITSHA]: 6,
  [delivery_option.OTHER]:  10,
};

function deliveryLabel(opt: delivery_option): string {
  if (opt === delivery_option.PICKUP) return 'Will Pickup (no delivery fee)';
  return opt.replace(/_/g, ' ');
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: DatabaseService,
    private readonly upload: UploadService,
    private readonly mail: MailService,
  ) {}

  // ── Create order ────────────────────────────────────────────────────────────

  async create(dto: CreateOrderDto) {
    if (dto.paymentRef) {
      const existing = await this.prisma.orders.findUnique({
        where: { paymentRef: dto.paymentRef },
      });
      if (existing) {
        throw new ConflictException('This payment reference has already been used.');
      }
    }

    const deliveryFee = DELIVERY_FEES[dto.deliveryOption] ?? 0;
    const unitPrice   = PRODUCT_PRICES[dto.productType ?? ''] ?? UNIT_PRICE_GBP;
    const totalPrice  = dto.quantity * unitPrice + deliveryFee;

    // Compose fullName for the orders table from the two separate fields
    const firstName = dto.firstName.trim();
    const lastName  = dto.lastName.trim();
    const fullName  = `${firstName} ${lastName}`;

    try {
      const attendee = await this.prisma.attendees.upsert({
        where:  { email: dto.email },
        update: { firstName, lastName },
        create: {
          id:              randomUUID(),
          firstName,
          lastName,
          email:           dto.email,
          dob:             new Date('1900-01-01'),
          city:            '',
          state:           dto.deliveryState  ?? '',
          country:         'Nigeria',
          deliveryAddress: dto.deliveryAddress ?? '',
        },
      });

      const orderId = randomUUID();
      const order = await this.prisma.orders.create({
        data: {
          id:              orderId,
          fullName,
          email:           dto.email,
          phone:           dto.phone,
          whatsapp:        dto.whatsapp,
          quantity:        dto.quantity,
          unitPrice:       unitPrice,
          totalPrice,
          deliveryOption:  dto.deliveryOption,
          deliveryAddress: dto.deliveryAddress,
          deliveryState:   dto.deliveryState,
          paymentRef:      dto.paymentRef,
          attendeeId:      attendee.id,
          status:          order_status.awaiting_payment,
          updatedAt:       new Date(),
        },
      });

      // Payment stays PENDING until an admin verifies it — receipt alone is not success.
      await this.prisma.transactions.create({
        data: {
          id:         randomUUID(),
          attendeeId: attendee.id,
          orderId:    order.id,
          amount:     totalPrice,
          currency:   'GBP',
          reference:  dto.paymentRef ?? `REF-${orderId}`,
          status:     'PENDING',
          updatedAt:  new Date(),
        },
      });

      // Await emails before returning — fire-and-forget gets killed on Vercel
      await Promise.allSettled([
        this.sendOrderReceivedEmail(order),
        this.sendAdminOrderEmail(order),
      ]);

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
    const order = await this.prisma.orders.findUnique({
      where:   { id: params.orderId },
      include: { attendees: true },
    });

    if (!order) {
      throw new NotFoundException(`Order ${params.orderId} not found.`);
    }

    const receiptUrl = await this.upload.uploadReceipt({
      buffer:   params.buffer,
      mimetype: params.mimetype,
      filename: params.filename,
      orderId:  params.orderId,
      fullName: order.fullName,
    });

    const updated = await this.prisma.orders.update({
      where: { id: params.orderId },
      data:  {
        receiptUrl,
        status: order_status.payment_proof_received,
      },
      include: { attendees: true },
    });

    // Receipt uploaded → payment proof received, but payment remains PENDING until verified.
    if (order.attendeeId) {
      const existingTxn = await this.prisma.transactions.findFirst({
        where: { orderId: order.id },
        orderBy: { createdAt: 'desc' },
      });

      if (existingTxn) {
        await this.prisma.transactions.update({
          where: { id: existingTxn.id },
          data: {
            receiptUrl,
            status: existingTxn.status === 'SUCCESS' ? 'SUCCESS' : 'PENDING',
            updatedAt: new Date(),
          },
        });
      } else {
        await this.prisma.transactions.create({
          data: {
            id:         randomUUID(),
            attendeeId: order.attendeeId,
            orderId:    order.id,
            amount:     order.totalPrice,
            currency:   'GBP',
            reference:  order.paymentRef ?? `REF-${randomUUID()}`,
            status:     'PENDING',
            receiptUrl,
            updatedAt:  new Date(),
          },
        });
      }
    }

    // Await emails before returning — fire-and-forget gets killed on Vercel
    await Promise.allSettled([
      this.sendReceiptConfirmationEmail(updated, receiptUrl),
      this.sendHostReceiptEmail(updated, receiptUrl),
    ]);

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
    return this.prisma.orders.findMany({
      orderBy: { createdAt: 'desc' },
      include: { attendees: true, transactions: true },
    });
  }

  async findOne(id: string) {
    return this.prisma.orders.findUnique({
      where:   { id },
      include: { attendees: true, transactions: true },
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
    deliveryOption: delivery_option;
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
    deliveryOption: delivery_option; paymentRef: string | null;
  }) {
    await this.mail.sendMailSafe({
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
    deliveryOption: delivery_option; paymentRef: string | null;
  }) {
    if (!HOST_EMAIL) {
      return;
    }
    await this.mail.sendMailSafe({
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
    deliveryOption: delivery_option;
  }, receiptUrl: string) {
    await this.mail.sendMailSafe({
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
          <p style="color:#64748b;font-size:13px">For enquiries reply to this email or <a href="https://wa.me/447958198281" style="color:#2563eb;text-decoration:underline">WhatsApp</a>.</p>
        </div>`,
    });
  }

  /** Sent to the host after buyer uploads their receipt */
  private async sendHostReceiptEmail(order: {
    id: string; fullName: string; email: string; phone: string;
    quantity: number; totalPrice: number;
    deliveryOption: delivery_option;
    deliveryAddress: string | null; deliveryState: string | null;
    paymentRef: string | null;
  }, receiptUrl: string) {
    if (!HOST_EMAIL) {
      return;
    }
    await this.mail.sendMailSafe({
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
