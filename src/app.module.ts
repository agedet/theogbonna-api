import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DatabaseModule } from './database/database.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { ExchangeRateModule } from './exchange-rate/exchange-rate.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import configuration from './config/configuration.js';
import { AdminModule } from './admin/admin.module.js';

const publicPath = join(__dirname, '..', 'public');

@Module({
  imports: [
    // ConfigModule must be first so every other module can inject ConfigService
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ServeStaticModule.forRoot({
      rootPath: publicPath,
      serveRoot: '/assets',
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            ttl: (configService.get<number>('rateLimit.ttl') ?? 60) * 1000,
            limit: configService.get<number>('rateLimit.limit') ?? 100,
          },
        ],
      }),
      inject: [ConfigService],
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    DatabaseModule,
    AuthModule,
    UsersModule,
    OrdersModule,
    ExchangeRateModule,
    AdminModule,
  ],
  // Only controllers / providers that genuinely belong at the root level
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
