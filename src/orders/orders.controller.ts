import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { File as MulterFile } from 'multer';
import { OrdersService } from './orders.service.js';
import { CreateOrderDto } from './dto/create-order.dto.js';

// 10 MB file size limit
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME   = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /** POST /orders — submit a new asoebi order */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateOrderDto) {
    return this.ordersService.create(dto);
  }

  /**
   * POST /orders/:id/receipt
   * Accepts a single multipart file field named "receipt".
   * Uploads it to Google Drive, saves the URL, fires emails, returns WhatsApp URL.
   */
  @Post(':id/receipt')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('receipt', {
      limits:    { fileSize: MAX_FILE_BYTES },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException(
            `File type ${file.mimetype} not allowed. Upload a JPG, PNG, WebP, or PDF.`,
          ), false);
        }
      },
    }),
  )
  async uploadReceipt(
    @Param('id') id: string,
    @UploadedFile() file: MulterFile,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded. Include a "receipt" field.');
    }

    return this.ordersService.attachReceipt({
      orderId:  id,
      buffer:   file.buffer,
      mimetype: file.mimetype,
      filename: file.originalname,
    });
  }

  /** GET /orders — admin: list all orders with attendee + transactions */
  @Get()
  findAll() {
    return this.ordersService.findAll();
  }

  /** GET /orders/:id */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ordersService.findOne(id);
  }
}
