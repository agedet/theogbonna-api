import { BaseEmailTemplate } from './base.template';
import { MailTemplateData } from '../interfaces/mail.interface';
import { EmailTemplate } from '../constants/template-names';

/**
 * Ticket Update Email Template
 */
export class OrderUpdateEmailTemplate extends BaseEmailTemplate {
  name = EmailTemplate.ORDER_UPDATE;

  render(data: MailTemplateData): string {
    const {
      ticketTitle,
      trackingId,
      projectName,
      updateMessage,
      updateType,
      oldStatus,
      newStatus,
      ticketLink,
    } = data;

    if (!ticketTitle) {
      throw new Error(
        'Ticket title is required for ticket update email template',
      );
    }

    let updateContent = '';

    if (updateType === 'status_change' && oldStatus && newStatus) {
      updateContent = `
        <div style="background-color: #e7f3ff; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #2196F3;">
          <p style="margin: 0 0 10px 0; font-weight: bold; color: #333;">Status Update</p>
          <p style="margin: 5px 0; color: #666;">
            Status changed from <strong style="color: #666;">${this.escapeHtml(oldStatus)}</strong> to 
            <strong style="color: #2196F3;">${this.escapeHtml(newStatus)}</strong>
          </p>
        </div>
      `;
    } else if (updateType === 'comment' && updateMessage) {
      updateContent = `
        <div style="background-color: #f0f0f0; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #4CAF50;">
          <p style="margin: 0 0 10px 0; font-weight: bold; color: #333;">New Comment</p>
          <p style="margin: 5px 0; color: #666;">${this.escapeHtml(updateMessage)}</p>
        </div>
      `;
    } else if (updateMessage) {
      updateContent = `
        <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #ffc107;">
          <p style="margin: 0; color: #666;">${this.escapeHtml(updateMessage)}</p>
        </div>
      `;
    }

    const content = `
      <h2 style="color: #333; margin-top: 0;">Ticket Update</h2>
      <p>Your ticket has been updated.</p>
      <div style="background-color: #fff; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #2196F3;">
        ${trackingId ? `<p style="margin: 0 0 10px 0; font-size: 18px; font-weight: bold; color: #333;">Ticket ID: <span style="color: #2196F3;">${this.escapeHtml(trackingId)}</span></p>` : ''}
        <h3 style="margin: 0 0 10px 0;">${this.escapeHtml(ticketTitle)}</h3>
        ${projectName ? `<p style="margin: 5px 0; color: #666;">Project: <strong>${this.escapeHtml(projectName)}</strong></p>` : ''}
      </div>
      ${updateContent}
      ${ticketLink ? `<p><a href="${this.escapeHtml(ticketLink)}" style="background-color: #2196F3; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View Ticket</a></p>` : ''}
      <p>Please check the ticket for more details.</p>
    `;

    return this.getBaseHtml(content, 'Ticket Update', undefined, data);
  }

  getSubject(data: MailTemplateData): string {
    const trackingId = data.trackingId
      ? ` [${this.escapeHtml(data.trackingId)}]`
      : '';
    const updateTypeText =
      data.updateType === 'status_change'
        ? 'Status Updated'
        : data.updateType === 'comment'
          ? 'New Comment'
          : 'Updated';
    return `Ticket ${updateTypeText}: ${this.escapeHtml(data.ticketTitle || 'Order')}${trackingId}`;
  }
}
