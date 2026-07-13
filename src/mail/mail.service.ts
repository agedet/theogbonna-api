import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { MailOptions } from './interfaces/mail.interface';
import { TemplateService } from './templates/template.service';
import { EmailTemplate } from './constants/template-names';

/** Minimum ms between any two emails to avoid SMTP rate limit (e.g. Microsoft 365 450 4.5.127) */
const MAIL_THROTTLE_MS = 10000; // Increased to 10 seconds for Microsoft 365 compatibility

/** Maximum retry attempts for rate limit errors */
const MAX_RETRY_ATTEMPTS = 5;

/** Base delay for exponential backoff (in ms) */
const BASE_RETRY_DELAY_MS = 30000; // 30 seconds

const delay = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Check if error is a rate limit error (450 4.5.127)
 */
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
  return (
    errorMessage.includes('450 4.5.127') ||
    errorMessage.includes('Excessive message rate') ||
    errorMessage.includes('rate limit') ||
    errorMessage.includes('too many') ||
    errorMessage.includes('throttle')
  );
}

/**
 * Mail Service - Handles sending emails with template support.
 * Uses a global send queue so all sends are serialized with a minimum interval (throttle).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;
  private lastSentAt = 0;
  private sendQueue: Promise<void> = Promise.resolve();
  private currentThrottleMs: number;
  private consecutiveRateLimitErrors = 0;

  constructor(
    private configService: ConfigService,
    private templateService: TemplateService,
  ) {
    this.currentThrottleMs =
      Number(this.configService.get('mailThrottleMs')) || MAIL_THROTTLE_MS;
    this.initializeTransporter();

    // Verify connection on startup (non-blocking)
    this.verifyConnection().catch(error => {
      this.logger.warn(
        `Email service verification failed on startup: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.logger.warn(
        'Emails may not send until SMTP configuration is corrected',
      );
    });
  }

  /** Wait until throttle allows sending (min interval since last send) */
  private async waitForThrottle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastSentAt;
    if (elapsed < this.currentThrottleMs && this.lastSentAt > 0) {
      const waitTime = this.currentThrottleMs - elapsed;
      this.logger.debug(
        `Throttling email send: waiting ${waitTime}ms (current throttle: ${this.currentThrottleMs}ms)`,
      );
      await delay(waitTime);
    }
  }

  /**
   * Adjust throttle interval based on rate limit errors
   * Increases throttle when rate limits are hit, decreases when successful
   */
  private adjustThrottle(rateLimitHit: boolean): void {
    const baseThrottle =
      Number(this.configService.get('mailThrottleMs')) || MAIL_THROTTLE_MS;
    const maxThrottle = baseThrottle * 4; // Max 4x the base throttle

    if (rateLimitHit) {
      this.consecutiveRateLimitErrors++;
      // Increase throttle exponentially up to max
      this.currentThrottleMs = Math.min(
        baseThrottle * Math.pow(2, this.consecutiveRateLimitErrors),
        maxThrottle,
      );
      this.logger.warn(
        `Rate limit detected. Increasing throttle to ${this.currentThrottleMs}ms (consecutive errors: ${this.consecutiveRateLimitErrors})`,
      );
    } else {
      // Gradually decrease throttle on success
      if (this.consecutiveRateLimitErrors > 0) {
        this.consecutiveRateLimitErrors = Math.max(
          0,
          this.consecutiveRateLimitErrors - 1,
        );
        this.currentThrottleMs = Math.max(
          baseThrottle,
          this.currentThrottleMs * 0.75,
        );
        this.logger.log(
          `Email sent successfully. Reducing throttle to ${this.currentThrottleMs}ms`,
        );
      } else {
        this.currentThrottleMs = baseThrottle;
      }
    }
  }

  /**
   * Initialize nodemailer transporter
   */
  private initializeTransporter(): void {
    const host =
      this.configService.get<string>('email.host') || 'smtp.gmail.com';
    const port = parseInt(
      this.configService.get<string>('email.port') || '587',
      10,
    );
    const secure = this.configService.get<string>('email.secure') === 'true';
    const user = this.configService.get<string>('email.user');
    const password = this.configService.get<string>('email.password');

    // Log configuration (without sensitive data)
    this.logger.log(
      `Initializing email transporter: ${host}:${port} (secure: ${secure}, user: ${user ? 'configured' : 'missing'})`,
    );

    if (!user || !password) {
      this.logger.error(
        'Email configuration incomplete: SMTP_USER and SMTP_PASS must be set',
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure, // true for 465, false for other ports
      // For Azure Communication Services and other services using STARTTLS on port 587
      requireTLS: !secure && port === 587,
      auth: {
        user,
        pass: password,
      },
      // Additional TLS options for better compatibility
      tls: {
        // Do not fail on invalid certificates (useful for development)
        rejectUnauthorized:
          this.configService.get<string>('nodeEnv') === 'production',
      },
    });
  }

  /**
   * Default From with display name (better recognition than bare noreply@).
   * Use SMTP_FROM on the same domain as SPF/DKIM for the sending account.
   */
  private resolveFromAddress(
    fromOverride?: string,
  ): string | { name: string; address: string } {
    if (fromOverride) {
      return fromOverride;
    }
    const address =
      this.configService.get<string>('email.from') || 'noreply@example.com';
    const name = this.configService.get<string>('email.fromName')?.trim();
    if (name) {
      return { name, address };
    }
    return address;
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

    // Render template if provided
    let emailHtml = html;
    let emailSubject = subject;
    let templateAttachments: Array<{
      filename: string;
      content: Buffer;
      cid: string;
      contentType: string;
    }> = [];

    if (template) {
      emailHtml = this.templateService.render(template, data);
      emailSubject = subject || this.templateService.getSubject(template, data);

      // Get CID image attachments from template (for embedded images)
      const templateInstance = this.templateService.getTemplate(template);
      if (
        templateInstance &&
        typeof templateInstance === 'object' &&
        templateInstance !== null &&
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

    // Generate plain text version if not provided (improves deliverability)
    let plainText = text;
    if (!plainText && emailHtml) {
      // Strip HTML tags for basic plain text version
      plainText = emailHtml
        .replace(/<style[^>]*>.*?<\/style>/gis, '')
        .replace(/<script[^>]*>.*?<\/script>/gis, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    const mailOptions: nodemailer.SendMailOptions = {
      from: this.resolveFromAddress(from),
      to: Array.isArray(to) ? to.join(', ') : to,
      subject: emailSubject,
      html: emailHtml,
      text: plainText, // Always include plain text version
      replyTo:
        replyToOverride ||
        this.configService.get<string>('email.replyTo') ||
        undefined,
      cc: cc ? (Array.isArray(cc) ? cc.join(', ') : cc) : undefined,
      bcc: bcc ? (Array.isArray(bcc) ? bcc.join(', ') : bcc) : undefined,
      attachments: attachments
        ? [...templateAttachments, ...attachments]
        : templateAttachments.length > 0
          ? templateAttachments
          : undefined,
      /**
       * Do not set Precedence: bulk or Auto-Submitted — those classify mail as
       * bulk/list traffic and strongly correlate with spam/promotions placement.
       * SPF/DKIM alignment for SMTP_FROM + SMTP_USER domain is still required for inbox delivery.
       */
    };

    const recipient = Array.isArray(to) ? to.join(', ') : to;
    const doSend = async (): Promise<void> => {
      await this.waitForThrottle();

      let lastError: Error | null = null;
      let attempt = 0;

      while (attempt < MAX_RETRY_ATTEMPTS) {
        attempt++;
        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
          const info = await this.transporter.sendMail(mailOptions);
          this.lastSentAt = Date.now();
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          this.logger.log(`Email sent to ${recipient}: ${info.messageId}`);
          this.adjustThrottle(false); // Success - reduce throttle if needed
          return; // Success, exit retry loop
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          const errorMessage = lastError.message;
          const errorStack = lastError.stack;
          const isRateLimit = isRateLimitError(error);

          // Log detailed error information for debugging
          this.logger.error(
            `Email send attempt ${attempt}/${MAX_RETRY_ATTEMPTS} failed for ${recipient}: ${errorMessage}`,
          );

          // Log full error details in debug mode
          if (errorStack) {
            this.logger.debug(`Error stack: ${errorStack}`);
          }

          // Log error code if available (common in nodemailer errors)
          if (error && typeof error === 'object' && 'code' in error) {
            const errorWithCode = error as { code: unknown };
            this.logger.debug(`Error code: ${String(errorWithCode.code)}`);
          }
          if (error && typeof error === 'object' && 'response' in error) {
            const errorWithResponse = error as { response: unknown };
            this.logger.debug(
              `SMTP response: ${String(errorWithResponse.response)}`,
            );
          }
          if (error && typeof error === 'object' && 'responseCode' in error) {
            const errorWithResponseCode = error as { responseCode: unknown };
            this.logger.debug(
              `SMTP response code: ${String(errorWithResponseCode.responseCode)}`,
            );
          }

          if (isRateLimit && attempt < MAX_RETRY_ATTEMPTS) {
            // Rate limit error - retry with exponential backoff
            const backoffDelay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
            this.logger.warn(
              `Rate limit error sending email to ${recipient} (attempt ${attempt}/${MAX_RETRY_ATTEMPTS}). Retrying in ${backoffDelay}ms...`,
            );
            this.adjustThrottle(true); // Increase throttle
            await delay(backoffDelay);
            // Wait for throttle again before retry
            await this.waitForThrottle();
            continue; // Retry
          } else {
            // Non-rate-limit error or max retries reached
            if (isRateLimit) {
              this.logger.error(
                `Failed to send email to ${recipient} after ${attempt} attempts due to rate limiting`,
                errorStack,
              );
            } else {
              this.logger.error(
                `Failed to send email to ${recipient} (attempt ${attempt}/${MAX_RETRY_ATTEMPTS}): ${errorMessage}`,
                errorStack,
              );
            }
            throw new Error(`Failed to send email: ${errorMessage}`);
          }
        }
      }

      // Should never reach here, but TypeScript needs it
      if (lastError) {
        throw new Error(
          `Failed to send email after ${MAX_RETRY_ATTEMPTS} attempts: ${lastError.message}`,
        );
      }
    };
    const ourSend = this.sendQueue.then(doSend);
    // Update queue to continue processing, but don't catch errors here
    // Errors from doSend should propagate to the caller via ourSend
    this.sendQueue = ourSend.catch(error => {
      // Log queue errors but don't throw to keep queue moving
      // Note: This catch is for queue continuity only; the error still propagates via ourSend
      this.logger.error(
        `Email queue error (email may have failed): ${error instanceof Error ? error.message : String(error)}`,
      );
      // Re-throw to ensure the error propagates to the caller
      throw error;
    });
    await ourSend;
  }

  /**
   * Send OTP email (convenience method)
   */
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

  /**
   * Send welcome email (convenience method)
   */
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

  /**
   * Send project invitation email (convenience method)
   */
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

  /**
   * Send user invitation email (convenience method)
   * Used for inviting both PARTNER and ENBROS users
   */
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
        platformName: 'Bwana Platform',
        isResend,
      },
    });
  }

  /**
   * Send task assignment email (convenience method)
   */
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

  /**
   * Send ticket created email (convenience method).
   * When createdByName is set, email shows "X created a ticket \"Y\" on your behalf."
   */
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

  /**
   * Send ticket update email (convenience method)
   */
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

  /**
   * Notify operations managers that a probation review is due.
   */
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

  /**
   * Notify a user that their probation has been confirmed.
   */
  async sendProbationConfirmedEmail(
    to: string,
    options: {
      userName: string;
    },
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

  /**
   * Ask a user to complete their admin profile.
   */
  async sendProfileCompletionReminderEmail(
    to: string,
    options: {
      userName: string;
      profileUrl: string;
    },
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

  /**
   * Verify email service connection
   */
  async verifyConnection(): Promise<boolean> {
    try {
      this.logger.log('Verifying email service connection...');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
      const result = await this.transporter.verify();
      this.logger.log('Email service connection verified successfully');

      if (result) {
        this.logger.debug(`SMTP server response: ${JSON.stringify(result)}`);
      }
      return true;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : JSON.stringify(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Email service connection failed: ${errorMessage}`,
        errorStack,
      );

      // Provide helpful debugging information
      const host = this.configService.get<string>('email.host');
      const port = this.configService.get<string>('email.port');
      const user = this.configService.get<string>('email.user');

      this.logger.error(
        `SMTP Configuration: host=${host}, port=${port}, user=${user ? 'configured' : 'MISSING'}`,
      );

      return false;
    }
  }
}
