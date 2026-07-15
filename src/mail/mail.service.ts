import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { MailOptions } from './interfaces/mail.interface.js';
import { TemplateService } from './templates/template.service.js';
import { EmailTemplate } from './constants/template-names.js';

/** Soft throttle between sends (Resend rate limits are higher than SMTP) */
const MAIL_THROTTLE_MS = 500;
const MAX_RETRY_ATTEMPTS = 5;
const BASE_RETRY_DELAY_MS = 2000;

const delay = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

function isRateLimitError(error: unknown): boolean {
  if (!error) return false;
  let errorMessage: string;
  if (error instanceof Error) {
    errorMessage = error.message;
  } else if (typeof error === 'string') {
    errorMessage = error;
  } else if (error && typeof error === 'object' && 'message' in error) {
    errorMessage = String((error as { message: unknown }).message);
  } else {
    errorMessage = JSON.stringify(error);
  }
  const status =
    error && typeof error === 'object' && 'statusCode' in error
      ? Number((error as { statusCode: unknown }).statusCode)
      : undefined;

  return (
    status === 429 ||
    errorMessage.includes('429') ||
    errorMessage.includes('rate_limit') ||
    errorMessage.includes('rate limit') ||
    errorMessage.includes('too many') ||
    errorMessage.includes('throttle')
  );
}

type ResendAttachment = {
  filename: string;
  content: Buffer | string;
  contentId?: string;
  contentType?: string;
};

/**
 * Mail Service — sends via Resend HTTP API (works on Vercel serverless).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend;
  private lastSentAt = 0;
  private sendQueue: Promise<void> = Promise.resolve();
  private currentThrottleMs: number;
  private consecutiveRateLimitErrors = 0;

  constructor(
    private configService: ConfigService,
    private templateService: TemplateService,
  ) {
    const apiKey = this.configService.get<string>('email.resendApiKey');
    if (!apiKey) {
      this.logger.error(
        'RESEND_API_KEY is not set — emails will fail until it is configured',
      );
    } else {
      this.logger.log('Resend mail client initialized');
    }

    this.resend = new Resend(apiKey || 'missing-resend-api-key');
    this.currentThrottleMs =
      Number(this.configService.get('mailThrottleMs')) || MAIL_THROTTLE_MS;
  }

  private async waitForThrottle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastSentAt;
    if (elapsed < this.currentThrottleMs && this.lastSentAt > 0) {
      await delay(this.currentThrottleMs - elapsed);
    }
  }

  private adjustThrottle(rateLimitHit: boolean): void {
    const baseThrottle =
      Number(this.configService.get('mailThrottleMs')) || MAIL_THROTTLE_MS;
    const maxThrottle = baseThrottle * 8;

    if (rateLimitHit) {
      this.consecutiveRateLimitErrors++;
      this.currentThrottleMs = Math.min(
        baseThrottle * Math.pow(2, this.consecutiveRateLimitErrors),
        maxThrottle,
      );
      this.logger.warn(
        `Rate limit detected. Throttle → ${this.currentThrottleMs}ms`,
      );
    } else if (this.consecutiveRateLimitErrors > 0) {
      this.consecutiveRateLimitErrors = Math.max(
        0,
        this.consecutiveRateLimitErrors - 1,
      );
      this.currentThrottleMs = Math.max(
        baseThrottle,
        this.currentThrottleMs * 0.75,
      );
    } else {
      this.currentThrottleMs = baseThrottle;
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

  private toAttachmentPayload(
    items: NonNullable<MailOptions['attachments']>,
  ): ResendAttachment[] {
    const out: ResendAttachment[] = [];

    for (const a of items) {
      if (a.content == null) {
        this.logger.warn(
          `Skipping attachment "${a.filename}" — only Buffer/string content is supported with Resend`,
        );
        continue;
      }

      out.push({
        filename: a.filename,
        content: a.content,
        ...(a.contentType ? { contentType: a.contentType } : {}),
        ...(a.cid ? { contentId: a.cid } : {}),
      });
    }

    return out;
  }

  /**
   * Send email with template support
   */
  async sendMail(options: MailOptions): Promise<void> {
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
        : undefined;

    const recipientList = Array.isArray(to) ? to : [to];
    const recipient = recipientList.join(', ');

    const payload = {
      from: this.resolveFromAddress(from),
      to: recipientList,
      subject: emailSubject,
      html: emailHtml,
      text: plainText,
      replyTo:
        replyToOverride ||
        this.configService.get<string>('email.replyTo') ||
        undefined,
      cc: cc ? (Array.isArray(cc) ? cc : [cc]) : undefined,
      bcc: bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : undefined,
      attachments:
        resendAttachments && resendAttachments.length > 0
          ? resendAttachments
          : undefined,
    };

    const doSend = async (): Promise<void> => {
      await this.waitForThrottle();

      let lastError: Error | null = null;
      let attempt = 0;

      while (attempt < MAX_RETRY_ATTEMPTS) {
        attempt++;
        try {
          const { data: result, error } = await this.resend.emails.send(
            payload as Parameters<Resend['emails']['send']>[0],
          );

          if (error) {
            throw Object.assign(new Error(error.message), {
              statusCode: (error as { statusCode?: number }).statusCode,
              name: error.name,
            });
          }

          this.lastSentAt = Date.now();
          this.logger.log(
            `Email sent to ${recipient}: ${result?.id ?? 'ok'}`,
          );
          this.adjustThrottle(false);
          return;
        } catch (error) {
          lastError =
            error instanceof Error ? error : new Error(String(error));
          const isRateLimit = isRateLimitError(error);

          this.logger.error(
            `Email send attempt ${attempt}/${MAX_RETRY_ATTEMPTS} failed for ${recipient}: ${lastError.message}`,
          );

          if (isRateLimit && attempt < MAX_RETRY_ATTEMPTS) {
            const backoffDelay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
            this.logger.warn(
              `Rate limited — retrying in ${backoffDelay}ms (attempt ${attempt}/${MAX_RETRY_ATTEMPTS})`,
            );
            this.adjustThrottle(true);
            await delay(backoffDelay);
            await this.waitForThrottle();
            continue;
          }

          throw new Error(`Failed to send email: ${lastError.message}`);
        }
      }

      if (lastError) {
        throw new Error(
          `Failed to send email after ${MAX_RETRY_ATTEMPTS} attempts: ${lastError.message}`,
        );
      }
    };

    const ourSend = this.sendQueue.then(doSend);
    this.sendQueue = ourSend.catch(error => {
      this.logger.error(
        `Email queue error: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    });
    await ourSend;
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

  /** Lightweight startup check — Resend has no SMTP verify() */
  async verifyConnection(): Promise<boolean> {
    const apiKey = this.configService.get<string>('email.resendApiKey');
    if (!apiKey) {
      this.logger.error('Resend not configured: RESEND_API_KEY is missing');
      return false;
    }
    this.logger.log(
      `Resend ready (from: ${this.resolveFromAddress()})`,
    );
    return true;
  }
}
