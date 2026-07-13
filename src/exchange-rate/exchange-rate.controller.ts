import { Controller, Get, Query, ParseFloatPipe, DefaultValuePipe } from '@nestjs/common';
import { ExchangeRateService } from './exchange-rate.service.js';

@Controller('exchange-rate')
export class ExchangeRateController {
  constructor(private readonly exchangeRateService: ExchangeRateService) {}

  /**
   * GET /exchange-rate/gbp-ngn
   * Optional query param: ?amount=100  (defaults to 100 — the asoebi unit price)
   *
   * Response:
   * {
   *   gbp:      100,
   *   ngn:      208450,
   *   rate:     2084.5,
   *   cachedAt: "2026-07-10T10:00:00.000Z",
   *   source:   "https://cdn.jsdelivr.net/…"
   * }
   */
  @Get('gbp-ngn')
  async getGbpToNgn(
    @Query('amount', new DefaultValuePipe(100), ParseFloatPipe)
    amount: number,
  ) {
    return this.exchangeRateService.convertGbpToNgn(amount);
  }
}
