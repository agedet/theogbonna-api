import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailOptions } from './interfaces/mail.interface.js';
import { TemplateService } from './templates/template.service.js';
import { EmailTemplate } from './constants/template-names.js';

const RESEND_API_URL = 'https://api.resend.com/emails';
const MAX_RETRY_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 750;

const delay = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

function isTransientError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error);

  return (
    message.includes('Unable to fetch data') ||
    message.includes('could not be resolved') ||
    message.includes('fetch failed') ||
    message.includes('ECONNRESET') ||
    message.includes('ETIMEDOUT') ||
    message.includes('ENOTFOUND') ||
    message.includes('socket hang up') ||
    message.includes('429') ||
    message.includes('rate_limit') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504')
  );
}

type ResendApiAttachment = {
  filename: string;
  content: string;
  content_id?: string;
  content_type?: string;
};

/**
 * Mail Service — Resend HTTP API via native fetch (Vercel-safe).
 *
 * Do not fire-and-forget on serverless: await sends (or allSettled) before
 * returning the HTTP response, or Vercel may freeze the isolate mid-request.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly apiKey: string;

  constructor(
    private configService: ConfigService,
    private templateService: TemplateService,
  ) {
    this.apiKey =
      this.configService.get<string>('email.resendApiKey')?.trim() ||
      process.env.RESEND_API_KEY?.trim() ||
      '';

    if (!this.apiKey) {
      this.logger.error(
        'RESEND_API_KEY is not set — emails will fail until configured on this environment',
      );
    } else {
      this.logger.log(
        `Resend ready (key=${this.apiKey.slice(0, 6)}…, from=${this.resolveFromAddress()})`,
      );
    }
  }

  private resolveFromAddress(fromOverride?: string): string {
    if (fromOverride?.trim()) return fromOverride.trim();

    const configured = this.configService.get<string>('email.from')?.trim();
    if (configured) return configured;

    const name = this.configService.get<string>('email.fromName')?.trim();
    const address =
      this.configService.get<string>('email.fromAddress')?.trim() ||
      'info@ogbonnasmemorial.com';

    return name ? `${name} <${address}>` : address;
  }

  private toBase64Content(content: string | Buffer): string {
    return Buffer.isBuffer(content)
      ? content.toString('base64')
      : Buffer.from(content).toString('base64');
  }

  private toAttachmentPayload(
    items: NonNullable<MailOptions['attachments']>,
  ): ResendApiAttachment[] {
    const out: ResendApiAttachment[] = [];

    for (const a of items) {
      if (a.content == null) {
        this.logger.warn(
          `Skipping attachment "${a.filename}" — only Buffer/string content is supported`,
        );
        continue;
      }

      out.push({
        filename: a.filename,
        content: this.toBase64Content(a.content),
        ...(a.contentType ? { content_type: a.contentType } : {}),
        ...(a.cid ? { content_id: a.cid } : {}),
      });
    }

    return out;
  }

  private buildPayload(options: MailOptions) {
    const {
      to,
      subject,
      template,
      data = {},
      html,
      text,
      from,
      replyTo: replyToOverride,
      cc,
      bcc,
      attachments,
    } = options;

    let emailHtml = html;
    let emailSubject = subject;
    let templateAttachments: NonNullable<MailOptions['attachments']> = [];

    if (template) {
      emailHtml = this.templateService.render(template, data);
      emailSubject = subject || this.templateService.getSubject(template, data);

      const templateInstance = this.templateService.getTemplate(template);
      if (
        templateInstance &&
        typeof templateInstance === 'object' &&
        'getImageAttachments' in templateInstance &&
        typeof (
          templateInstance as {
            getImageAttachments?: () => typeof templateAttachments;
          }
        ).getImageAttachments === 'function'
      ) {
        templateAttachments = (
          templateInstance as {
            getImageAttachments: () => typeof templateAttachments;
          }
        ).getImageAttachments();
      }
    }

    if (!emailHtml && !text) {
      throw new Error('Either template, html, or text must be provided');
    }

    if (!emailSubject) {
      throw new Error(
        'Email subject is required (either provide subject or use a template)',
      );
    }

    let plainText = text;
    if (!plainText && emailHtml) {
      plainText = emailHtml
        .replace(/<style[^>]*>.*?<\/style>/gis, '')
        .replace(/<script[^>]*>.*?<\/script>/gis, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    const allAttachments = [
      ...templateAttachments,
      ...(attachments ?? []),
    ];
    const resendAttachments =
      allAttachments.length > 0
        ? this.toAttachmentPayload(allAttachments)
        : [];

    const recipientList = Array.isArray(to) ? to : [to];

    return {
      recipient: recipientList.join(', '),
      body: {
        from: this.resolveFromAddress(from),
        to: recipientList,
        subject: emailSubject,
        ...(emailHtml ? { html: emailHtml } : {}),
        ...(plainText ? { text: plainText } : {}),
        ...(replyToOverride || this.configService.get<string>('email.replyTo')
          ? {
              reply_to:
                replyToOverride ||
                this.configService.get<string>('email.replyTo'),
            }
          : {}),
        ...(cc
          ? { cc: Array.isArray(cc) ? cc : [cc] }
          : {}),
        ...(bcc
          ? { bcc: Array.isArray(bcc) ? bcc : [bcc] }
          : {}),
        ...(resendAttachments.length > 0
          ? { attachments: resendAttachments }
          : {}),
      },
    };
  }

  private async postToResend(
    body: Record<string, unknown>,
  ): Promise<{ id?: string }> {
    if (!this.apiKey) {
      throw new Error('RESEND_API_KEY is not configured');
    }

    let response: Response;
    try {
      response = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Unable to reach Resend API (${message}). Check outbound network / DNS on this host.`,
      );
    }

    const raw = await response.text();
    let parsed: { id?: string; message?: string; name?: string } = {};
    try {
      parsed = raw ? (JSON.parse(raw) as typeof parsed) : {};
    } catch {
      parsed = { message: raw || response.statusText };
    }

    if (!response.ok) {
      throw new Error(
        parsed.message ||
          `Resend HTTP ${response.status}: ${raw || response.statusText}`,
      );
    }

    return parsed;
  }

  /**
   * Send email. Throws on failure after retries.
   * Prefer await / allSettled on serverless — do not detach the promise.
   */
  async sendMail(options: MailOptions): Promise<void> {
    const { recipient, body } = this.buildPayload(options);

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        const result = await this.postToResend(body);
        this.logger.log(`Email sent to ${recipient}: ${result.id ?? 'ok'}`);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.error(
          `Email send attempt ${attempt}/${MAX_RETRY_ATTEMPTS} failed for ${recipient}: ${lastError.message}`,
        );

        if (isTransientError(error) && attempt < MAX_RETRY_ATTEMPTS) {
          await delay(BASE_RETRY_DELAY_MS * attempt);
          continue;
        }
        break;
      }
    }

    throw new Error(
      `Failed to send email: ${lastError?.message ?? 'unknown error'}`,
    );
  }

  /**
   * Best-effort send — never throws. Safe for background side-effects when awaited via allSettled.
   */
  async sendMailSafe(options: MailOptions): Promise<boolean> {
    try {
      await this.sendMail(options);
      return true;
    } catch (error) {
      this.logger.error(
        `Email suppressed failure: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  async sendOtpEmail(
    email: string,
    otpCode: string,
    userName?: string,
    expirationMinutes?: number,
  ): Promise<void> {
    await this.sendMail({
      to: email,
      template: EmailTemplate.OTP,
      data: {
        otpCode,
        userName: userName || 'User',
        expirationMinutes: expirationMinutes || 10,
      },
    });
  }

  async sendWelcomeEmail(
    email: string,
    userName?: string,
    loginUrl?: string,
  ): Promise<void> {
    await this.sendMail({
      to: email,
      template: EmailTemplate.WELCOME,
      data: {
        userName: userName || 'User',
        loginUrl,
      },
    });
  }

  async sendProjectInvitationEmail(
    email: string,
    projectName: string,
    invitationLink?: string,
    userName?: string,
    inviterName?: string,
  ): Promise<void> {
    await this.sendMail({
      to: email,
      template: EmailTemplate.PROJECT_INVITATION,
      data: {
        userName: userName || 'User',
        projectName,
        invitationLink,
        inviterName,
      },
    });
  }

  async sendUserInvitationEmail(
    email: string,
    role: string,
    invitationLink: string,
    userName?: string,
    inviterName?: string,
    isResend = false,
  ): Promise<void> {
    await this.sendMail({
      to: email,
      template: EmailTemplate.USER_INVITATION,
      data: {
        userName: userName || 'User',
        role,
        invitationLink,
        inviterName,
        platformName: 'Ogbonnas Memorial',
        isResend,
      },
    });
  }

  async sendTaskAssignmentEmail(
    email: string,
    taskTitle: string,
    projectName?: string,
    taskLink?: string,
    userName?: string,
    assignerName?: string,
  ): Promise<void> {
    await this.sendMail({
      to: email,
      template: EmailTemplate.TASK_ASSIGNMENT,
      data: {
        userName: userName || 'User',
        taskTitle,
        projectName,
        taskLink,
        assignerName,
      },
    });
  }

  async sendTicketCreatedEmail(
    email: string,
    ticketTitle: string,
    projectName?: string,
    ticketDescription?: string,
    ticketLink?: string,
    priority?: string,
    trackingId?: string,
    createdByName?: string,
  ): Promise<void> {
    await this.sendMail({
      to: email,
      template: EmailTemplate.ORDER_CREATED,
      data: {
        ticketTitle,
        projectName,
        ticketDescription,
        ticketLink,
        priority: priority || 'MEDIUM',
        trackingId: trackingId || '',
        createdByName,
      },
    });
  }

  async sendTicketUpdateEmail(
    email: string,
    ticketTitle: string,
    trackingId?: string,
    projectName?: string,
    updateMessage?: string,
    updateType?: 'status_change' | 'comment' | 'other',
    oldStatus?: string,
    newStatus?: string,
    ticketLink?: string,
  ): Promise<void> {
    await this.sendMail({
      to: email,
      template: EmailTemplate.ORDER_UPDATE,
      data: {
        ticketTitle,
        trackingId: trackingId || '',
        projectName,
        updateMessage,
        updateType,
        oldStatus,
        newStatus,
        ticketLink,
      },
    });
  }

  async sendProbationReviewRequestEmail(
    to: string,
    options: {
      reviewerName: string;
      employeeName: string;
      employeeEmail: string;
      startDate?: string;
      reviewUrl: string;
    },
  ): Promise<void> {
    const startDateLine = options.startDate
      ? `<p style="margin:0 0 16px 0;color:#475467;font-size:14px;">Start date: <strong>${options.startDate}</strong></p>`
      : '';

    await this.sendMail({
      to,
      subject: `Probation review due for ${options.employeeName}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#101828;">
          <p style="margin:0 0 16px 0;font-size:14px;">Hello ${options.reviewerName},</p>
          <p style="margin:0 0 16px 0;font-size:14px;">
            ${options.employeeName} (${options.employeeEmail}) has reached the 3-month probation review point.
          </p>
          ${startDateLine}
          <p style="margin:0 0 20px 0;font-size:14px;">
            Please open the user details page to confirm probation completion or extend probation.
          </p>
          <a href="${options.reviewUrl}" style="display:inline-block;background:#4C4185;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;">
            Review probation
          </a>
        </div>
      `,
    });
  }

  async sendProbationConfirmedEmail(
    to: string,
    options: { userName: string },
  ): Promise<void> {
    await this.sendMail({
      to,
      subject: 'Your probation has been confirmed',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#101828;">
          <p style="margin:0 0 16px 0;font-size:14px;">Hello ${options.userName},</p>
          <p style="margin:0 0 16px 0;font-size:14px;">
            Your probation period has been successfully completed and confirmed.
          </p>
          <p style="margin:0;font-size:14px;">
            Thank you for the good work you have done so far.
          </p>
        </div>
      `,
    });
  }

  async sendProfileCompletionReminderEmail(
    to: string,
    options: { userName: string; profileUrl: string },
  ): Promise<void> {
    await this.sendMail({
      to,
      subject: 'Please complete your profile',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#101828;">
          <p style="margin:0 0 16px 0;font-size:14px;">Hello ${options.userName},</p>
          <p style="margin:0 0 16px 0;font-size:14px;">
            Your profile is not yet complete. Please sign in and finish the missing sections so we have your up-to-date information.
          </p>
          <a href="${options.profileUrl}" style="display:inline-block;background:#4C4185;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;">
            Complete your profile
          </a>
        </div>
      `,
    });
  }

  async verifyConnection(): Promise<boolean> {
    if (!this.apiKey) {
      this.logger.error('Resend not configured: RESEND_API_KEY is missing');
      return false;
    }
    this.logger.log(`Resend configured (from: ${this.resolveFromAddress()})`);
    return true;
  }
}
