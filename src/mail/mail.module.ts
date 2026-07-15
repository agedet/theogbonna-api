import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { TemplateService } from './templates/template.service';

/**
 * Mail Module - Provides email functionality with template support
 * This module is global so it can be used across the application
 */
@Global()
@Module({
  providers: [MailService, TemplateService],
  exports: [MailService, TemplateService],
})
export class MailModule {}
