import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { UploadModule } from '../upload/upload.module.js';

@Module({
  imports:     [UploadModule],
  controllers: [OrdersController],
  providers:   [OrdersService],
})
export class OrdersModule {}
