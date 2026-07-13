import { BaseEmailTemplate } from './base.template';
import { MailTemplateData } from '../interfaces/mail.interface';
import { EmailTemplate } from '../constants/template-names';

/**
 * Welcome Email Template
 */
export class WelcomeEmailTemplate extends BaseEmailTemplate {
  name = EmailTemplate.WELCOME;

  render(data: MailTemplateData): string {
    const { userName = 'User', loginUrl } = data;

    const content = `
      <h2 style="color: #333; margin-top: 0;">Welcome to Our Platform!</h2>
      <p>Hello ${this.escapeHtml(userName)},</p>
      <p>Thank you for joining us! We're excited to have you on board.</p>
      <p>Your account has been successfully created. You can now start using our platform.</p>
      ${loginUrl ? `<p><a href="${this.escapeHtml(loginUrl)}" style="background-color: #007bff; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Get Started</a></p>` : ''}
      <p>If you have any questions, feel free to reach out to our support team.</p>
    `;

    return this.getBaseHtml(content, 'Welcome', undefined, data);
  }

  getSubject(_data: MailTemplateData): string {
    return 'Welcome to Our Platform!';
  }
}
