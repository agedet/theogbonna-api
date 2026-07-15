import { BaseEmailTemplate } from './base.template';
import { MailTemplateData } from '../interfaces/mail.interface';
import { EmailTemplate } from '../constants/template-names';

/**
 * Ticket Created Email Template
 */
export class OrderCreatedEmailTemplate extends BaseEmailTemplate {
  name = EmailTemplate.ORDER_CREATED;

  render(data: MailTemplateData): string {
    const {
      ticketTitle,
      projectName,
      ticketDescription,
      ticketLink,
      priority = 'MEDIUM',
      trackingId,
      createdByName,
    } = data;

    if (!ticketTitle) {
      throw new Error(
        'Ticket title is required for ticket created email template',
      );
    }

    const priorityColors: Record<string, string> = {
      LOW: '#6c757d',
      MEDIUM: '#ffc107',
      HIGH: '#fd7e14',
      URGENT: '#dc3545',
    };

    const priorityColor =
      priorityColors[priority.toUpperCase()] || priorityColors.MEDIUM;

    const introParagraph = createdByName
      ? `<p><strong>${this.escapeHtml(createdByName)}</strong> created a ticket "<strong>${this.escapeHtml(ticketTitle)}</strong>" on your behalf.</p>`
      : '<p>A new ticket has been created in your project.</p>';

    const content = `
      <h2 style="color: #333; margin-top: 0;">New Ticket Created</h2>
      ${introParagraph}
      <div style="background-color: #fff; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid ${priorityColor};">
        ${trackingId ? `<p style="margin: 0 0 10px 0; font-size: 18px; font-weight: bold; color: #333;">Ticket ID: <span style="color: ${priorityColor};">${this.escapeHtml(trackingId)}</span></p>` : ''}
        <h3 style="margin: 0 0 10px 0;">${this.escapeHtml(ticketTitle)}</h3>
        ${projectName ? `<p style="margin: 5px 0; color: #666;">Project: <strong>${this.escapeHtml(projectName)}</strong></p>` : ''}
        <p style="margin: 5px 0; color: #666;">Priority: <strong style="color: ${priorityColor};">${this.escapeHtml(priority)}</strong></p>
        ${ticketDescription ? `<p style="margin: 10px 0;">${this.escapeHtml(ticketDescription)}</p>` : ''}
      </div>
      ${ticketLink ? `<p><a href="${this.escapeHtml(ticketLink)}" style="background-color: ${priorityColor}; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View Ticket</a></p>` : ''}
      <p>Please review and respond to this ticket as soon as possible.</p>
    `;

    return this.getBaseHtml(content, 'New Ticket', undefined, data);
  }

  getSubject(data: MailTemplateData): string {
    const trackingId = data.trackingId
      ? ` [${this.escapeHtml(data.trackingId)}]`
      : '';
    return `New Order: ${this.escapeHtml(data.ticketTitle || 'Order Created')}${trackingId}`;
  }
}
