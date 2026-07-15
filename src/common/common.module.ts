import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [],
  exports: [],
})
export class CommonModule {}