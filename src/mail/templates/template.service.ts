import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IEmailTemplate, MailTemplateData } from '../interfaces/mail.interface';
import { OtpEmailTemplate } from './otp.template';
import { WelcomeEmailTemplate } from './welcome.templates';
import { OrderCreatedEmailTemplate } from './order-created.templates';
import { OrderUpdateEmailTemplate } from './order-update.template';
import { UserInvitationEmailTemplate } from './user-invitation.template';

/**
 * Template Service - Manages all email templates
 */
@Injectable()
export class TemplateService {
  private readonly logger = new Logger(TemplateService.name);
  private templates: Map<string, IEmailTemplate> = new Map();
  private readonly backendUrl: string;

  constructor(private readonly configService: ConfigService) {
    // Get backend URL from config, ensuring it works in both dev and production
    this.backendUrl =
      this.configService.get<string>('backendUrl') ||
      process.env.BACKEND_URL ||
      `http://localhost:${process.env.PORT || '3001'}`;
    // Remove trailing slash
    this.backendUrl = this.backendUrl.replace(/\/$/, '');
    this.logger.log(`Email template backend URL: ${this.backendUrl}`);
    this.registerTemplates();
  }

  /**
   * Register all available email templates
   */
  private registerTemplates(): void {
    const templateInstances: IEmailTemplate[] = [
      new OtpEmailTemplate(),
      new WelcomeEmailTemplate(),
      new UserInvitationEmailTemplate(),
      new OrderCreatedEmailTemplate(),
      new OrderUpdateEmailTemplate(),
    ];

    templateInstances.forEach(template => {
      this.templates.set(template.name, template);
      this.logger.debug(`Registered email template: ${template.name}`);
    });

    this.logger.log(`Registered ${this.templates.size} email templates`);
  }

  /**
   * Register a custom template
   */
  registerTemplate(template: IEmailTemplate): void {
    this.templates.set(template.name, template);
    this.logger.log(`Registered custom email template: ${template.name}`);
  }

  /**
   * Get a template by name
   */
  getTemplate(templateName: string): IEmailTemplate {
    const template = this.templates.get(templateName);
    if (!template) {
      throw new Error(`Email template '${templateName}' not found`);
    }
    return template;
  }

  /**
   * Render a template with data
   */
  render(templateName: string, data: MailTemplateData): string {
    const template = this.getTemplate(templateName);
    try {
      // Pass backendUrl to template via data so it can be used for image URLs
      const templateData = {
        ...data,
        backendUrl: this.backendUrl,
      };
      return template.render(templateData);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to render template '${templateName}': ${errorMessage}`,
      );
      throw error;
    }
  }

  /**
   * Get subject for a template
   */
  getSubject(templateName: string, data: MailTemplateData): string {
    const template = this.getTemplate(templateName);
    return template.getSubject ? template.getSubject(data) : 'Notification';
  }

  /**
   * Check if a template exists
   */
  hasTemplate(templateName: string): boolean {
    return this.templates.has(templateName);
  }

  /**
   * Get all registered template names
   */
  getAvailableTemplates(): string[] {
    return Array.from(this.templates.keys());
  }
}
