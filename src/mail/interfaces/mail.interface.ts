/**
 * Mail template data interface
 */
export interface MailTemplateData {
  [key: string]: any;
}

/**
 * Mail options interface
 */
export interface MailOptions {
  to: string | string[];
  subject?: string; // Optional if template is provided (template will generate subject)
  template?: string;
  data?: MailTemplateData;
  html?: string;
  text?: string;
  from?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: Array<{
    filename: string;
    path?: string;
    content?: string | Buffer;
    contentType?: string;
    cid?: string; // Content-ID for inline images
  }>;
}

/**
 * Template renderer interface
 */
export interface ITemplateRenderer {
  render(templateName: string, data: MailTemplateData): Promise<string>;
}

/**
 * Base template interface
 */
export interface IEmailTemplate {
  name: string;
  render(data: MailTemplateData): string;
  getSubject?(data: MailTemplateData): string;
}
