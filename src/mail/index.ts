/**
 * Mail Module - Centralized email functionality with template support
 *
 * @module MailModule
 */

export { MailModule } from './mail.module';
export { MailService } from './mail.service';
export { TemplateService } from './templates/template.service';
export { BaseEmailTemplate } from './templates/base.template';
export { EmailTemplate } from './constants/template-names';
export * from './interfaces/mail.interface';

// Export all templates for custom usage
export { OtpEmailTemplate } from './templates/otp.template';
export { WelcomeEmailTemplate } from './templates/welcome.templates';
export { UserInvitationEmailTemplate } from './templates/user-invitation.template';
export { OrderCreatedEmailTemplate } from './templates/order-created.templates';
export { OrderUpdateEmailTemplate } from './templates/order-update.template';
