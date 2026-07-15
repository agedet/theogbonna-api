import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { MailModule } from '../mail/mail.module.js';

@Module({
  imports:     [MailModule],
  controllers: [AdminController],
  providers:   [AdminService],
})
export class AdminModule {}
