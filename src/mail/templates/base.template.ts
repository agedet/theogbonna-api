import { IEmailTemplate, MailTemplateData } from '../interfaces/mail.interface';
import * as he from 'he';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Base email template — Ogbonna Memorial brand
 *
 * Matches the frontend memorial site:
 * - Dark slate surfaces (slate-950)
 * - Amber accents (amber-500 / amber-600)
 * - Embedded CID logo from public/email-assets
 */
export abstract class BaseEmailTemplate implements IEmailTemplate {
  abstract name: string;

  /** Brand tokens aligned with Tailwind amber / slate used in theogbonna */
  protected readonly colors = {
    primary: '#D97706', // amber-600 — CTAs
    primaryHover: '#B45309', // amber-700
    accent: '#F59E0B', // amber-500
    accentSoft: '#FBBF24', // amber-400
    textStrong: '#0F172A', // slate-900 — body text on white cards
    textSub: '#64748B', // slate-500
    textSoft: '#94A3B8', // slate-400
    textOnDark: '#E2E8F0', // slate-200
    white: '#FFFFFF',
    bgPage: '#020617', // slate-950
    bgHeader: '#0F172A', // slate-900
    bgGradientStart: '#0F172A', // slate-900
    bgGradientMid: '#1C1917', // warm near-black
    bgGradientEnd: '#78350F', // amber-900
    strokeSoft: '#E2E8F0', // slate-200
    otpBg: '#FFFBEB', // amber-50
  };

  abstract render(data: MailTemplateData): string;

  getSubject(data: MailTemplateData): string {
    return data.subject || 'Ogbonna Memorial';
  }

  protected escapeHtml(text: string | undefined | null): string {
    if (!text) return '';
    return he.encode(text, { useNamedReferences: false });
  }

  protected readonly links = {
    website: 'https://www.ogbonnasmemorial.com/',
    contact: 'https://www.ogbonnasmemorial.com/#invitation',
    supportEmail: 'info@ogbonnasmemorial.com',
  };

  protected get imageCids() {
    return {
      logo: 'cid:ogbonna-logo',
    };
  }

  getImageAttachments(): Array<{
    filename: string;
    content: Buffer;
    cid: string;
    contentType: string;
  }> {
    try {
      const assetsPath = this.findAssetsPath();
      if (!assetsPath) {
        console.warn(
          '[Email Template] Assets folder not found — logo will be missing. Expected public/email-assets/ogbonna-logo.png',
        );
        return [];
      }

      const attachments: Array<{
        filename: string;
        content: Buffer;
        cid: string;
        contentType: string;
      }> = [];

      const logoPath = path.join(assetsPath, 'ogbonna-logo.png');
      if (fs.existsSync(logoPath)) {
        attachments.push({
          filename: 'ogbonna-logo.png',
          content: fs.readFileSync(logoPath),
          cid: 'ogbonna-logo',
          contentType: 'image/png',
        });
      } else {
        console.warn(`[Email Template] Logo not found at ${logoPath}`);
      }

      return attachments;
    } catch (error) {
      console.error('[Email Template] Error creating image attachments:', error);
      return [];
    }
  }

  private findAssetsPath(): string | null {
    const cwd = process.cwd();
    const possiblePaths = [
      path.join(cwd, 'public', 'email-assets'),
      path.join(cwd, 'dist', 'public', 'email-assets'),
      path.join(__dirname, '..', '..', '..', 'public', 'email-assets'),
      path.join(__dirname, '..', '..', '..', '..', 'public', 'email-assets'),
    ];

    for (const testPath of possiblePaths) {
      if (fs.existsSync(testPath)) {
        return testPath;
      }
    }
    return null;
  }

  protected getBaseHtml(
    content: string,
    title?: string,
    options?: {
      showHeader?: boolean;
      showFooter?: boolean;
      contactEmail?: string;
      websiteUrl?: string;
    },
    _data?: MailTemplateData,
  ): string {
    const {
      showHeader = true,
      showFooter = true,
      contactEmail = this.links.supportEmail,
      websiteUrl = this.links.website,
    } = options || {};

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${this.escapeHtml(title || 'Ogbonna Memorial')}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style type="text/css">
    body, table, td, p, a, li, blockquote {
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }
    table, td {
      mso-table-lspace: 0pt;
      mso-table-rspace: 0pt;
    }
    img {
      -ms-interpolation-mode: bicubic;
      border: 0;
      height: auto;
      line-height: 100%;
      outline: none;
      text-decoration: none;
    }
    a[x-apple-data-detectors] {
      color: inherit !important;
      text-decoration: none !important;
      font-size: inherit !important;
      font-family: inherit !important;
      font-weight: inherit !important;
      line-height: inherit !important;
    }
    u + #body a {
      color: inherit;
      text-decoration: none;
      font-size: inherit;
      font-family: inherit;
      font-weight: inherit;
      line-height: inherit;
    }
  </style>
</head>
<body id="body" style="margin: 0; padding: 0; width: 100%; background-color: ${this.colors.bgPage}; font-family: Georgia, 'Times New Roman', Times, serif;">
  
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${this.colors.bgPage};">
    <tr>
      <td align="center" style="padding: 0;">
        
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%;">
          
          ${showHeader ? this.getHeaderHtml(websiteUrl) : ''}
          
          <tr>
            <td style="background: linear-gradient(160deg, ${this.colors.bgGradientStart} 0%, ${this.colors.bgGradientMid} 45%, ${this.colors.bgGradientEnd} 100%); padding: 40px 20px;">
              <!--[if mso]>
              <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:600px;">
                <v:fill type="gradient" color="${this.colors.bgGradientStart}" color2="${this.colors.bgGradientEnd}" angle="160"/>
                <v:textbox style="mso-fit-shape-to-text:true" inset="0,0,0,0">
              <![endif]-->
              
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 500px; background-color: ${this.colors.white}; border-radius: 16px; border: 1px solid rgba(245,158,11,0.25); box-shadow: 0 12px 40px rgba(0,0,0,0.35);">
                      <tr>
                        <td style="padding: 40px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
                          ${content}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              
              <!--[if mso]>
                </v:textbox>
              </v:rect>
              <![endif]-->
            </td>
          </tr>
          
          ${showFooter ? this.getFooterHtml(contactEmail, websiteUrl) : ''}
          
        </table>
        
      </td>
    </tr>
  </table>
  
</body>
</html>`;
  }

  protected getHeaderHtml(websiteUrl: string): string {
    const logoUrl = this.imageCids.logo;

    return `
          <!-- Header -->
          <tr>
            <td style="background-color: ${this.colors.bgHeader}; padding: 28px 40px; border-bottom: 1px solid rgba(245,158,11,0.25);">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                   <td align="center">
                     <a href="${this.escapeHtml(websiteUrl)}" target="_blank" style="text-decoration: none;">
                       <img src="${logoUrl}" alt="Ogbonna Memorial" width="160" height="64" style="display: block; margin: 0 auto; border: 0; outline: none; max-width: 160px; height: auto;" />
                     </a>
                     <p style="margin: 12px 0 0 0; font-family: Georgia, 'Times New Roman', serif; font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase; color: ${this.colors.accent};">
                       In Loving Memory
                     </p>
                   </td>
                </tr>
              </table>
            </td>
          </tr>`;
  }

  protected getFooterHtml(contactEmail: string, websiteUrl: string): string {
    return `
          <!-- Footer -->
          <tr>
            <td style="background-color: ${this.colors.bgPage}; padding: 32px 24px; text-align: center; border-top: 1px solid rgba(245,158,11,0.15);">
              <p style="margin: 0 0 8px 0; font-family: Georgia, 'Times New Roman', serif; font-size: 14px; line-height: 22px; color: ${this.colors.textSoft};">
                © ${new Date().getFullYear()} Ogbonna Memorial. All rights reserved.
              </p>
              <p style="margin: 0 0 12px 0; font-size: 12px; line-height: 18px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; color: ${this.colors.textSoft};">
                <a href="${this.escapeHtml(websiteUrl)}" style="color: ${this.colors.accent}; text-decoration: none;">www.ogbonnasmemorial.com</a>
                &nbsp;·&nbsp;
                <a href="mailto:${this.escapeHtml(contactEmail)}" style="color: ${this.colors.accent}; text-decoration: none;">${this.escapeHtml(contactEmail)}</a>
              </p>
              <p style="margin: 0; font-size: 12px; line-height: 18px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; color: ${this.colors.textSoft};">
                Questions?
                <a href="mailto:${this.escapeHtml(contactEmail)}" style="color: ${this.colors.accent}; text-decoration: underline;">Contact us</a>
              </p>
            </td>
          </tr>`;
  }

  protected getButtonHtml(
    text: string,
    href: string,
    options?: { fullWidth?: boolean },
  ): string {
    const { fullWidth = true } = options || {};

    return `
      <table role="presentation" width="${fullWidth ? '100%' : 'auto'}" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
        <tr>
          <td align="center">
            <!--[if mso]>
            <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${this.escapeHtml(href)}" style="height:48px;v-text-anchor:middle;width:280px;" arcsize="20%" stroke="f" fillcolor="${this.colors.primary}">
              <w:anchorlock/>
              <center style="color:#ffffff;font-family:sans-serif;font-size:14px;font-weight:600;">
                ${this.escapeHtml(text)}
              </center>
            </v:roundrect>
            <![endif]-->
            <!--[if !mso]><!-->
            <a href="${this.escapeHtml(href)}" target="_blank" style="
              display: inline-block;
              background-color: ${this.colors.primary};
              color: ${this.colors.white};
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
              font-size: 14px;
              font-weight: 600;
              line-height: 20px;
              text-align: center;
              text-decoration: none;
              padding: 14px 28px;
              border-radius: 12px;
              ${fullWidth ? 'width: 100%; box-sizing: border-box;' : ''}
            ">
              ${this.escapeHtml(text)}
            </a>
            <!--<![endif]-->
          </td>
        </tr>
      </table>`;
  }

  protected getDividerHtml(): string {
    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
        <tr>
          <td style="border-top: 1px solid ${this.colors.strokeSoft};"></td>
        </tr>
      </table>`;
  }

  protected getHelpTextHtml(): string {
    return `
      <p style="margin: 24px 0 0 0; font-size: 14px; line-height: 22px; color: ${this.colors.textSub}; text-align: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">
        Having trouble?
        <a href="mailto:${this.escapeHtml(this.links.supportEmail)}" target="_blank" style="color: ${this.colors.primary}; font-weight: 700; text-decoration: underline;">Contact us</a>
      </p>`;
  }
}
