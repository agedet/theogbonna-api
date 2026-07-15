import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// fawazahmed0's CDN — completely free, no auth, daily updated.
// We try the latest date first, then fall back to "latest" alias.
const CDN_URLS = [
  `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/gbp.json`,
  `https://latest.currency-api.pages.dev/v1/currencies/gbp.json`,
];

interface RateCache {
  rate:      number;
  fetchedAt: Date;
}

@Injectable()
export class ExchangeRateService {
  private readonly logger = new Logger(ExchangeRateService.name);
  private cache: RateCache | null = null;

  /**
   * Returns the live GBP → NGN mid-market rate.
   * Result is cached for 1 hour to avoid hammering the upstream CDN.
   */
  async getGbpToNgn(): Promise<{ rate: number; cachedAt: Date; source: string }> {
    if (this.cache && Date.now() - this.cache.fetchedAt.getTime() < CACHE_TTL_MS) {
      this.logger.debug(`Returning cached rate: ${this.cache.rate} (age ${Math.round((Date.now() - this.cache.fetchedAt.getTime()) / 1000)}s)`);
      return { rate: this.cache.rate, cachedAt: this.cache.fetchedAt, source: 'cache' };
    }

    for (const url of CDN_URLS) {
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(8_000), // 8 s hard timeout
        });

        if (!res.ok) continue;

        const json = await res.json() as { gbp: Record<string, number> };
        const rate = json?.gbp?.ngn;

        if (!rate || typeof rate !== 'number' || rate <= 0) {
          this.logger.warn(`Unexpected rate payload from ${url}`);
          continue;
        }

        this.cache = { rate, fetchedAt: new Date() };
        this.logger.log(`Fetched fresh GBP/NGN rate: ${rate} from ${url}`);
        return { rate, cachedAt: this.cache.fetchedAt, source: url };
      } catch (err) {
        this.logger.warn(`Failed to fetch from ${url}: ${(err as Error).message}`);
      }
    }

    // All upstream sources failed — return stale cache if available rather than erroring
    if (this.cache) {
      this.logger.warn('All upstream sources failed; serving stale cache');
      return { rate: this.cache.rate, cachedAt: this.cache.fetchedAt, source: 'stale-cache' };
    }

    throw new ServiceUnavailableException(
      'Exchange rate service is temporarily unavailable. Please try again shortly.',
    );
  }

  /**
   * Converts a GBP amount to its NGN equivalent using the live rate.
   * Rounds to the nearest whole naira.
   */
  async convertGbpToNgn(gbpAmount: number): Promise<{
    gbp:          number;
    ngn:          number;
    rate:         number;
    cachedAt:     Date;
    source:       string;
  }> {
    const { rate, cachedAt, source } = await this.getGbpToNgn();
    return {
      gbp:      gbpAmount,
      ngn:      Math.round(gbpAmount * rate),
      rate,
      cachedAt,
      source,
    };
  }
}
