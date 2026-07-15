import { Module } from '@nestjs/common';
import { UploadService } from './upload.service.js';

@Module({
  providers: [UploadService],
  exports:   [UploadService],
})
export class UploadModule {}
