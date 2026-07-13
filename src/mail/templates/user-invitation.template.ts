import { BaseEmailTemplate } from './base.template';
import { MailTemplateData } from '../interfaces/mail.interface';
import { EmailTemplate } from '../constants/template-names';

/**
 * User Invitation Email Template
 * Used for inviting both PARTNER and ENBROS users to the platform
 * Design follows Bwana-v2 Figma specifications
 */
export class UserInvitationEmailTemplate extends BaseEmailTemplate {
  name = EmailTemplate.USER_INVITATION;

  render(data: MailTemplateData): string {
    const { userName = 'there', role, invitationLink, isResend = false } = data;

    const isEnbros = role === 'ENBROS';

    // Different content based on user role
    const content = isEnbros
      ? this.renderEnbrosContent(
          userName as string,
          invitationLink as string,
          isResend as boolean,
        )
      : this.renderPartnerContent(
          userName as string,
          invitationLink as string,
          isResend as boolean,
        );

    const title = isEnbros
      ? isResend
        ? 'Reminder: Join the Enbros Team'
        : 'Welcome to the Enbros Team'
      : 'Welcome to your project portal on Bwana';

    return this.getBaseHtml(content, title, undefined, data);
  }

  /**
   * Render ENBROS team member invitation content
   * Optimized to avoid spam filters - transactional, not promotional
   */
  private renderEnbrosContent(
    userName: string,
    invitationLink?: string,
    isResend = false,
  ): string {
    return `
      <!-- Title -->
      <h1 style="margin: 0 0 8px 0; font-family: 'Satoshi', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; font-size: 20px; font-weight: 700; line-height: 28px; color: ${this.colors.textStrong};">
        ${isResend ? 'Team Account Access Link' : 'Your Team Account is Ready'}
      </h1>
      
      <!-- Greeting -->
      <div style="font-family: 'Satoshi', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; font-size: 16px; line-height: 24px; color: ${this.colors.textStrong}; letter-spacing: -0.18px;">
        <p style="margin: 0; font-weight: 500;">
          Hello ${this.escapeHtml(userName)},
        </p>
        <p style="margin: 0 0 16px 0;">
          ${
            isResend
              ? 'Your administrator has resent your access link to the Bwana team workspace.'
              : 'Your administrator has created a team account for you on Bwana.'
          }
        </p>
        
        <p style="margin: 0 0 16px 0;">
          Please use the secure link below to access your account within the next 24 hours.
        </p>
      </div>
      
      <!-- CTA Button -->
      ${invitationLink ? this.getButtonHtml('Access Your Account', invitationLink) : ''}
      
      <!-- Divider -->
      ${this.getDividerHtml()}
      
      <!-- Login method note -->
      <p style="margin: 0 0 8px 0; font-family: 'Satoshi', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; font-size: 14px; line-height: 20px; color: ${this.colors.textSub};">
        <strong>Authentication:</strong> Use your Google Workspace account to sign in securely.
      </p>
      
      <!-- Security note -->
      <p style="margin: 0 0 8px 0; font-family: 'Satoshi', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; font-size: 14px; line-height: 20px; color: ${this.colors.textSub};">
        <strong>Important:</strong> This link expires in 24 hours for security purposes.
      </p>
      
      <!-- Disclaimer -->
      <p style="margin: 0; font-family: 'Satoshi', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; font-size: 14px; line-height: 20px; color: ${this.colors.textSoft};">
        If you did not expect this email, please contact your administrator or ignore this message.
      </p>
      
      <!-- Help text -->
      ${this.getHelpTextHtml()}
    `;
  }

  /**
   * Render PARTNER/Client invitation content
   */
  private renderPartnerContent(
    userName: string,
    invitationLink?: string,
    _isResend = false,
  ): string {
    return `
      <!-- Title -->
      <h1 style="margin: 0 0 16px 0; font-family: 'Satoshi', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; font-size: 20px; font-weight: 700; line-height: 28px; color: ${this.colors.textStrong};">
        Welcome to your project portal on Bwana
      </h1>
      
      <!-- Greeting and intro -->
      <div style="font-family: 'Satoshi', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; font-size: 16px; line-height: 24px; color: ${this.colors.textStrong}; letter-spacing: -0.18px;">
        <p style="margin: 0 0 16px 0;">
          Hi ${this.escapeHtml(userName)},
        </p>
        <p style="margin: 0 0 16px 0;">
          Welcome to Bwana, your dedicated project hub with Enbros.
        </p>
        <p style="margin: 0 0 16px 0;">
          We've just assigned you to your project dashboard. Bwana is designed to give you full visibility into our work, allowing you to track real-time progress, easily raise new requests or bug reports, and ask questions directly to the development team.
        </p>
      </div>
      
      <!-- CTA Button -->
      ${invitationLink ? this.getButtonHtml('Log in to Bwana', invitationLink) : ''}
      
      <!-- Closing -->
      <div style="font-family: 'Satoshi', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; font-size: 16px; line-height: 24px; color: ${this.colors.textStrong}; letter-spacing: -0.18px;">
        <p style="margin: 0 0 16px 0;">
          We are excited to collaborate with you more transparently and efficiently. If you have any trouble logging in, <a href="${this.escapeHtml(this.links.contact)}" target="_blank" style="color: ${this.colors.primary}; text-decoration: underline;">contact us</a>.
        </p>
        <p style="margin: 0 0 4px 0;">
          Best regards,
        </p>
        <p style="margin: 0; font-weight: 600;">
          The Enbros Team
        </p>
      </div>
    `;
  }

  getSubject(data: MailTemplateData): string {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const isResend = data.isResend || false;
    const isEnbros = data.role === 'ENBROS';

    if (isEnbros) {
      return isResend
        ? 'Action Required: Team Account Access Link - Bwana'
        : 'Action Required: Your Team Account - Bwana';
    }

    // PARTNER subject - same for new and resend
    return 'Welcome to your project portal on Bwana';
  }
}
