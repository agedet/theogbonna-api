import { Module } from '@nestjs/common';
import { ExchangeRateController } from './exchange-rate.controller.js';
import { ExchangeRateService } from './exchange-rate.service.js';

@Module({
  controllers: [ExchangeRateController],
  providers:   [ExchangeRateService],
  exports:     [ExchangeRateService], // available for other modules if needed later
})
export class ExchangeRateModule {}
