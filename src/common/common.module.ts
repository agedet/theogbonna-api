import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database/database.module';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [],
  exports: [],
})
export class CommonModule {}