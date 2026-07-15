import { BaseEmailTemplate } from './base.template';
import { MailTemplateData } from '../interfaces/mail.interface';
import { EmailTemplate } from '../constants/template-names';

/**
 * User Invitation Email Template
 *
 * Supports three audience branches:
 *   role === 'admin'   → Ogbonna Memorial admin invitation (primary use-case)
 *   role === 'ENBROS'  → Internal Enbros team member (legacy)
 *   anything else      → Generic partner/client invitation (legacy)
 */
export class UserInvitationEmailTemplate extends BaseEmailTemplate {
  name = EmailTemplate.USER_INVITATION;

  render(data: MailTemplateData): string {
    const { userName = 'there', role, invitationLink, inviterName, isResend = false } = data;

    const isAdmin  = role === 'admin' || role === 'super_admin';
    const isEnbros = role === 'ENBROS';

    let content: string;
    let title:   string;

    if (isAdmin) {
      content = this.renderAdminContent(
        userName as string,
        invitationLink as string,
        inviterName as string | undefined,
        isResend as boolean,
      );
      title = isResend
        ? 'Reminder: Admin Account Invitation — Ogbonna Memorial'
        : 'You\'ve been invited as an Admin — Ogbonna Memorial';
    } else if (isEnbros) {
      content = this.renderEnbrosContent(userName as string, invitationLink as string, isResend as boolean);
      title   = isResend ? 'Reminder: Join the Enbros Team' : 'Welcome to the Enbros Team';
    } else {
      content = this.renderPartnerContent(userName as string, invitationLink as string);
      title   = 'Welcome to your project portal on Bwana';
    }

    return this.getBaseHtml(content, title, undefined, data);
  }

  // ─── Ogbonna Memorial admin invitation ──────────────────────────────────────

  private renderAdminContent(
    userName:       string,
    invitationLink: string,
    inviterName    = 'The Super Admin',
    isResend       = false,
  ): string {
    return `
      <h1 style="margin:0 0 8px 0;font-family:sans-serif;font-size:22px;font-weight:700;color:${this.colors.textStrong};">
        ${isResend ? 'Your Invitation Link (Resent)' : 'You\'ve been invited to join the team'}
      </h1>

      <div style="font-family:sans-serif;font-size:16px;line-height:24px;color:${this.colors.textStrong};">
        <p style="margin:0 0 16px 0;">
          Hi <strong>${this.escapeHtml(userName)}</strong>,
        </p>
        <p style="margin:0 0 16px 0;">
          ${this.escapeHtml(inviterName)} has invited you to the
          <strong>Ogbonna Memorial</strong> admin platform${isResend ? ' (this is a reminder)' : ''}.
        </p>
        <p style="margin:0 0 16px 0;">
          Click the button below to set up your password and access the dashboard.
          This link is valid for <strong>7 days</strong>.
        </p>
      </div>

      ${invitationLink ? this.getButtonHtml('Set Up My Account', invitationLink) : ''}

      ${this.getDividerHtml()}

      <p style="margin:0 0 8px 0;font-family:sans-serif;font-size:13px;color:${this.colors.textSub};">
        <strong>What you can do as an admin:</strong> view and manage asoebi orders,
        verify payment receipts, and update order statuses.
      </p>

      <p style="margin:0 0 8px 0;font-family:sans-serif;font-size:13px;color:${this.colors.textSub};">
        <strong>Security note:</strong> This link expires in 7 days and can only be used once.
        If you did not expect this invitation, you can safely ignore this email.
      </p>

      ${this.getHelpTextHtml()}
    `;
  }

  // ─── Legacy: ENBROS team member ──────────────────────────────────────────────

  private renderEnbrosContent(userName: string, invitationLink?: string, isResend = false): string {
    return `
      <h1 style="margin:0 0 8px 0;font-family:sans-serif;font-size:20px;font-weight:700;color:${this.colors.textStrong};">
        ${isResend ? 'Team Account Access Link' : 'Your Team Account is Ready'}
      </h1>
      <div style="font-family:sans-serif;font-size:16px;line-height:24px;color:${this.colors.textStrong};">
        <p style="margin:0 0 16px 0;">Hello ${this.escapeHtml(userName)},</p>
        <p style="margin:0 0 16px 0;">
          ${isResend ? 'Your administrator has resent your access link.' : 'Your administrator has created a team account for you on Bwana.'}
        </p>
        <p style="margin:0 0 16px 0;">Please use the link below within the next 24 hours.</p>
      </div>
      ${invitationLink ? this.getButtonHtml('Access Your Account', invitationLink) : ''}
      ${this.getDividerHtml()}
      <p style="font-family:sans-serif;font-size:13px;color:${this.colors.textSub};">
        <strong>Important:</strong> This link expires in 24 hours.
      </p>
      ${this.getHelpTextHtml()}
    `;
  }

  // ─── Legacy: partner/client ───────────────────────────────────────────────────

  private renderPartnerContent(userName: string, invitationLink?: string): string {
    return `
      <h1 style="margin:0 0 16px 0;font-family:sans-serif;font-size:20px;font-weight:700;color:${this.colors.textStrong};">
        Welcome to your project portal on Bwana
      </h1>
      <div style="font-family:sans-serif;font-size:16px;line-height:24px;color:${this.colors.textStrong};">
        <p style="margin:0 0 16px 0;">Hi ${this.escapeHtml(userName)},</p>
        <p style="margin:0 0 16px 0;">Welcome to Bwana, your dedicated project hub with Enbros.</p>
      </div>
      ${invitationLink ? this.getButtonHtml('Log in to Bwana', invitationLink) : ''}
    `;
  }

  getSubject(data: MailTemplateData): string {
    const isAdmin  = data.role === 'admin' || data.role === 'super_admin';
    const isEnbros = data.role === 'ENBROS';
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const isResend = data.isResend || false;

    if (isAdmin) {
      return isResend
        ? 'Reminder: Set up your Ogbonna Memorial admin account'
        : 'You\'ve been invited to the Ogbonna Memorial admin platform';
    }

    if (isEnbros) {
      return isResend
        ? 'Action Required: Team Account Access Link - Bwana'
        : 'Action Required: Your Team Account - Bwana';
    }

    return 'Welcome to your project portal on Bwana';
  }
}
