import { IEmailTemplate, MailTemplateData } from '../interfaces/mail.interface';
import * as he from 'he';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Base email template class - Bwana Platform Design
 * All email templates should extend this class
 *
 * Design based on Figma: Bwana-v2 Email Template
 * - Gradient background (blue to purple/orange)
 * - White header with logo and social icons
 * - White content card with shadow
 * - Purple accent color (#4C4185)
 */
export abstract class BaseEmailTemplate implements IEmailTemplate {
  abstract name: string;

  // Design tokens from Figma
  protected readonly colors = {
    primary: '#4C4185', // Foundation/Purple/Normal
    textStrong: '#0E121B', // Text/Strong
    textSub: '#525866', // Text/Sub
    textSoft: '#99A0AE', // Text/Soft
    white: '#FFFFFF',
    bgGradientStart: '#25B2E2', // Blue gradient start
    bgGradientEnd: '#E8A87C', // Orange/warm gradient end
    strokeSoft: '#E1E4EA',
  };

  /**
   * Render the email template with provided data
   */
  abstract render(data: MailTemplateData): string;

  /**
   * Get email subject (optional override)
   */
  getSubject(data: MailTemplateData): string {
    return data.subject || 'Notification';
  }

  /**
   * Escape HTML to prevent XSS attacks
   * @param text - Text to escape
   * @returns Escaped HTML string
   */
  protected escapeHtml(text: string | undefined | null): string {
    if (!text) return '';
    return he.encode(text, { useNamedReferences: false });
  }

  // External links - Enbros company links
  protected readonly links = {
    website: 'https://enbros.co.uk/',
    contact: 'https://enbros.co.uk/contact',
    linkedin: 'https://www.linkedin.com/company/enbros/',
    supportEmail: 'support@enbros.co.uk',
  };

  // CID references for embedded images
  // Using CID (Content-ID) attachments is more reliable than URL-based images
  // because email clients often block external images or URLs may be inaccessible
  protected get imageCids() {
    return {
      logo: 'cid:bwana-logo',
      globeIcon: 'cid:icon-globe',
      linkedinIcon: 'cid:icon-linkedin',
    };
  }

  /**
   * Get image attachments for email (CID embedded images)
   * These are attached to the email and referenced via cid: URLs
   * Works reliably in all email clients and environments
   */
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
          '[Email Template] Assets folder not found, skipping image attachments',
        );
        return [];
      }

      const attachments: Array<{
        filename: string;
        content: Buffer;
        cid: string;
        contentType: string;
      }> = [];

      const logoPath = path.join(assetsPath, 'bwana-logo.png');
      const globePath = path.join(assetsPath, 'globe.png');
      const linkedinPath = path.join(assetsPath, 'linkedin.png');

      if (fs.existsSync(logoPath)) {
        attachments.push({
          filename: 'bwana-logo.png',
          content: fs.readFileSync(logoPath),
          cid: 'bwana-logo',
          contentType: 'image/png',
        });
      }

      if (fs.existsSync(globePath)) {
        attachments.push({
          filename: 'globe.png',
          content: fs.readFileSync(globePath),
          cid: 'icon-globe',
          contentType: 'image/png',
        });
      }

      if (fs.existsSync(linkedinPath)) {
        attachments.push({
          filename: 'linkedin.png',
          content: fs.readFileSync(linkedinPath),
          cid: 'icon-linkedin',
          contentType: 'image/png',
        });
      }

      console.log(
        `[Email Template] Created ${attachments.length} CID image attachments`,
      );
      return attachments;
    } catch (error) {
      console.error(
        '[Email Template] Error creating image attachments:',
        error,
      );
      return [];
    }
  }

  /**
   * Find the email assets folder (works in both dev and production)
   */
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

  /**
   * Get base HTML structure following Bwana design
   * @param content - The main content to be placed in the white card
   * @param title - Email title for the HTML head
   * @param options - Additional options for customization
   * @param data - Template data (contains backendUrl)
   */
  protected getBaseHtml(
    content: string,
    title?: string,
    options?: {
      showHeader?: boolean;
      showFooter?: boolean;
      contactEmail?: string;
      websiteUrl?: string;
    },
    data?: MailTemplateData,
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
  <title>${this.escapeHtml(title || 'Bwana Platform')}</title>
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
    /* Reset styles */
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
    /* iOS blue links */
    a[x-apple-data-detectors] {
      color: inherit !important;
      text-decoration: none !important;
      font-size: inherit !important;
      font-family: inherit !important;
      font-weight: inherit !important;
      line-height: inherit !important;
    }
    /* Gmail blue links */
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
<body id="body" style="margin: 0; padding: 0; width: 100%; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  
  <!-- Outer wrapper -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f5f5f5;">
    <tr>
      <td align="center" style="padding: 0;">
        
        <!-- Email container -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%;">
          
          ${showHeader ? this.getHeaderHtml(websiteUrl) : ''}
          
          <!-- Background section with gradient effect -->
          <tr>
            <td style="background: linear-gradient(135deg, ${this.colors.bgGradientStart} 0%, #7B68A8 50%, ${this.colors.bgGradientEnd} 100%); padding: 40px 20px;">
              <!--[if mso]>
              <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:600px;">
                <v:fill type="gradient" color="${this.colors.bgGradientStart}" color2="${this.colors.bgGradientEnd}" angle="135"/>
                <v:textbox style="mso-fit-shape-to-text:true" inset="0,0,0,0">
              <![endif]-->
              
              <!-- White content card -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 500px; background-color: ${this.colors.white}; border-radius: 10px; box-shadow: 0 8px 50px 6px rgba(0,0,0,0.15), 0 4px 50px 0 rgba(0,0,0,0.15);">
                      <tr>
                        <td style="padding: 40px;">
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

  /**
   * Get header HTML with logo and social icons
   * Uses CID embedded images for maximum email client compatibility
   * Images are attached to the email and referenced via cid: URLs
   */
  protected getHeaderHtml(websiteUrl: string): string {
    // Use CID references - images are embedded as attachments
    const logoUrl = this.imageCids.logo;
    const globeUrl = this.imageCids.globeIcon;
    const linkedinUrl = this.imageCids.linkedinIcon;

    return `
          <!-- Header -->
          <tr>
            <td style="background-color: ${this.colors.white}; padding: 20px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                   <td align="left" style="width: 50%;">
                     <a href="${this.escapeHtml(websiteUrl)}" target="_blank" style="text-decoration: none;">
                       <img src="${logoUrl}" alt="Bwana" width="132" height="30" style="display: block; border: 0; outline: none; max-width: 132px; height: auto;" />
                     </a>
                   </td>
                   <td align="right" style="width: 50%;">
                     <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                       <tr>
                         <td style="padding-right: 24px;">
                           <a href="${this.escapeHtml(this.links.website)}" target="_blank" style="text-decoration: none;">
                             <img src="${globeUrl}" alt="Website" width="28" height="28" style="display: block; border: 0; outline: none;" />
                           </a>
                         </td>
                         <td>
                           <a href="${this.escapeHtml(this.links.linkedin)}" target="_blank" style="text-decoration: none;">
                             <img src="${linkedinUrl}" alt="LinkedIn" width="28" height="28" style="display: block; border: 0; outline: none;" />
                           </a>
                         </td>
                       </tr>
                     </table>
                   </td>
                </tr>
              </table>
            </td>
          </tr>`;
  }

  /**
   * Get footer HTML
   */
  protected getFooterHtml(contactEmail: string, websiteUrl: string): string {
    return `
          <!-- Footer -->
          <tr>
            <td style="background-color: transparent; padding: 30px 20px; text-align: center;">
              <p style="margin: 0 0 10px 0; font-size: 14px; line-height: 20px; color: ${this.colors.textSoft};">
                © ${new Date().getFullYear()} Enbros. All rights reserved.
              </p>
              <p style="margin: 0; font-size: 12px; line-height: 18px; color: ${this.colors.textSoft};">
                Questions? 
                <a href="${this.escapeHtml(this.links.contact)}" style="color: ${this.colors.primary}; text-decoration: underline;">Contact us</a>
              </p>
            </td>
          </tr>`;
  }

  /**
   * Get styled button HTML
   */
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
            <a href="${this.escapeHtml(href)}" target="_blank" style="
              display: inline-block;
              background-color: ${this.colors.primary};
              color: ${this.colors.white};
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
              font-size: 14px;
              font-weight: 500;
              line-height: 20px;
              text-align: center;
              text-decoration: none;
              padding: 12px 24px;
              border-radius: 10px;
              ${fullWidth ? 'width: 100%; box-sizing: border-box;' : ''}
            ">
              ${this.escapeHtml(text)}
            </a>
          </td>
        </tr>
      </table>`;
  }

  /**
   * Get styled divider HTML
   */
  protected getDividerHtml(): string {
    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
        <tr>
          <td style="border-top: 1px solid ${this.colors.strokeSoft};"></td>
        </tr>
      </table>`;
  }

  /**
   * Get styled help text HTML
   */
  protected getHelpTextHtml(): string {
    return `
      <p style="margin: 24px 0 0 0; font-size: 16px; line-height: 24px; color: ${this.colors.textStrong}; text-align: center;">
        Having troubles with your account? 
        <a href="${this.escapeHtml(this.links.contact)}" target="_blank" style="color: ${this.colors.primary}; font-weight: 700; text-decoration: underline;">Contact us</a>
      </p>`;
  }
}
