import { BaseEmailTemplate } from './base.template';
import { MailTemplateData } from '../interfaces/mail.interface';
import { EmailTemplate } from '../constants/template-names';

/**
 * OTP Email Template
 * Used for login verification and password reset OTP codes
 * Design follows Bwana-v2 Figma specifications (node 344:2233)
 */
export class OtpEmailTemplate extends BaseEmailTemplate {
  name = EmailTemplate.OTP;

  // Additional color from Figma design
  private readonly otpBgColor = '#EDECF3'; // Foundation/Purple/Light

  render(data: MailTemplateData): string {
    const { otpCode, userName = 'there', expirationMinutes = 10 } = data;

    if (!otpCode) {
      throw new Error('OTP code is required for OTP email template');
    }

    // Format OTP code with spaces for better readability
    const formattedOtp = this.formatOtpCode(otpCode);

    const content = `
      <!-- Title -->
      <h1 style="margin: 0 0 8px 0; font-family: 'Satoshi', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; font-size: 20px; font-weight: 700; line-height: 28px; color: ${this.colors.textStrong};">
        Verify Your Account
      </h1>
      
      <!-- Greeting and intro -->
      <div style="font-family: 'Satoshi', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; font-size: 16px; line-height: 24px; color: ${this.colors.textStrong}; letter-spacing: -0.18px;">
        <p style="margin: 0; font-weight: 500;">
          Hey ${this.escapeHtml(userName)},
        </p>
        <p style="margin: 0 0 10px 0;">
          We received a request to verify your account on the Bwana Portal.
        </p>
        <p style="margin: 0 0 10px 0;">
          To proceed, please use the following One-Time Password (OTP):
        </p>
      </div>
      
      <!-- OTP Code Box -->
      <div style="background-color: ${this.otpBgColor}; padding: 10px; margin: 0 0 10px 0; text-align: center;">
        <p style="margin: 0; font-family: 'Satoshi', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; font-size: 16px; font-weight: 500; line-height: 24px; color: ${this.colors.textStrong}; letter-spacing: 3.84px;">
          ${formattedOtp}
        </p>
      </div>
      
      <!-- Note and security message -->
      <div style="font-family: 'Satoshi', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; font-size: 16px; line-height: 24px; color: ${this.colors.textStrong}; letter-spacing: -0.18px;">
        <p style="margin: 0 0 16px 0;">
          <strong style="font-weight: 500;">Note:</strong> This code is valid for ${expirationMinutes} minutes. For your security, please do not share this code with anyone.
        </p>
        
        <p style="margin: 0;">
          If you did not request this verification code, you can safely ignore this email. Your account remains secure.
        </p>
      </div>
      
      <!-- Divider -->
      ${this.getDividerHtml()}
      
      <!-- Help text -->
      ${this.getHelpTextHtml()}
    `;

    return this.getBaseHtml(content, 'Verify Your Account', undefined, data);
  }

  /**
   * Format OTP code with spaces for better readability
   * e.g., "842901" becomes "8 4 2  9 0 1"
   */
  private formatOtpCode(code: string): string {
    const chars = code.split('');
    // Add space between each character, double space in middle
    const midpoint = Math.floor(chars.length / 2);
    return chars
      .map((char, index) => {
        if (index === midpoint - 1) {
          return char + ' '; // Extra space before midpoint
        }
        return char;
      })
      .join(' ');
  }

  getSubject(_data: MailTemplateData): string {
    return 'Your Verification Code - Bwana';
  }
}
