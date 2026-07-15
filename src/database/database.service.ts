import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  HttpException,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { LoggerService } from '../common/services/logger.service.js';
import { DatabaseException } from '../common/exceptions/database.exceptions.js';

/** Interactive transaction client (no connection / nesting helpers). */
type PrismaTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;

@Injectable()
export class DatabaseService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new LoggerService().setContext('DatabaseService');

  constructor() {
    // Prisma 6.x: Uses DATABASE_URL from .env file (via dotenv.config() in main.ts)
    // Prisma 6.x handles connection pooling internally, no adapter needed

    // Ensure DATABASE_URL is available before initializing PrismaClient
    if (!process.env.DATABASE_URL) {
      throw new Error(
        'DATABASE_URL environment variable is required. Make sure .env file is loaded and contains DATABASE_URL.',
      );
    }

    // Initialize PrismaClient (Prisma 6.x handles connection pooling internally)
    super({
      log:
        process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Database connection established successfully');

      // Long-lived interval is pointless on serverless (Vercel sets VERCEL=1)
      if (!process.env.VERCEL) {
        this.setupConnectionMonitoring();
      }
    } catch (error) {
      this.logger.error(
        'Failed to connect to database',
        (error as Error).stack,
      );
      throw new DatabaseException('Database connection failed');
    }
  }

  /**
   * Monitor database connection health and automatically reconnect if needed
   */
  private setupConnectionMonitoring() {
    // Check connection health every 5 minutes
    setInterval(
      () => {
        void (async () => {
          try {
            await this.$queryRaw`SELECT 1`;
            this.logger.debug('Database connection health check passed');
          } catch {
            this.logger.warn(
              'Database connection health check failed, attempting reconnect...',
            );
            try {
              await this.$disconnect();
              await this.$connect();
              this.logger.log('Database reconnection successful');
            } catch (reconnectError) {
              this.logger.error(
                'Database reconnection failed',
                (reconnectError as Error).stack,
              );
            }
          }
        })();
      },
      5 * 60 * 1000,
    ); // Every 5 minutes
  }

  async onModuleDestroy() {
    try {
      await this.$disconnect();
      this.logger.log('Database connection closed successfully');
    } catch (error) {
      this.logger.error(
        'Failed to disconnect from database',
        (error as Error).stack,
      );
    }
  }

  // Enhanced query methods with error handling and timeout protection
  async safeQuery<T>(
    queryFn: () => Promise<T>,
    operation: string,
    timeout: number = 30000,
  ): Promise<T> {
    try {
      this.logger.debug(`Executing database operation: ${operation}`);

      // Wrap query in a timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              `Database operation timeout: ${operation} (${timeout}ms)`,
            ),
          );
        }, timeout);
      });

      const result = await Promise.race([queryFn(), timeoutPromise]);

      this.logger.debug(
        `Database operation completed successfully: ${operation}`,
      );
      return result;
    } catch (error) {
      // Preserve HTTP exceptions (BadRequestException, NotFoundException, etc.)
      // so that specific error messages are returned to the client
      if (error instanceof HttpException) {
        this.logger.debug(`Re-throwing HTTP exception: ${error.message}`);
        throw error;
      }

      const errorStack = error instanceof Error ? error.stack : undefined;
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : String(error);
      this.logger.error(`Database operation failed: ${operation}`, errorStack);

      // Handle connection timeout errors
      if (errorMessage.includes('Connection terminated')) {
        this.logger.warn(
          'Connection timeout detected, attempting to reconnect...',
        );
        try {
          await this.$disconnect();
          await this.$connect();
          this.logger.log('Reconnected successfully, retrying operation...');
          // Retry the operation once after reconnecting
          return await queryFn();
        } catch (retryError) {
          this.logger.error(
            'Retry after reconnection failed',
            (retryError as Error).stack,
          );
          throw new DatabaseException(
            'Database connection lost. Please try again.',
          );
        }
      }

      // Handle specific Prisma errors
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new DatabaseException('Duplicate entry found', 409);
        }
        if (error.code === 'P2025') {
          throw new DatabaseException('Record not found', 404);
        }
        if (error.code === 'P2003') {
          throw new DatabaseException('Foreign key constraint failed', 400);
        }
        if (error.code === 'P1001' || error.code === 'P1002') {
          throw new DatabaseException(
            'Database connection failed. Please try again.',
            503,
          );
        }
      }

      throw new DatabaseException(`Database operation failed: ${operation}`);
    }
  }

  // Transaction wrapper with error handling
  async transaction<T>(
    fn: (prisma: PrismaTransactionClient) => Promise<T>,
    timeout: number = 30000, // Increased default timeout to 30 seconds
  ): Promise<T> {
    try {
      this.logger.debug('Starting database transaction');

      const result = await this.$transaction(fn, {
        timeout: timeout, // 30 seconds default timeout (increased from 10)
        maxWait: parseInt(process.env.DATABASE_MAX_WAIT || '15000', 10), // 15 seconds max wait (increased from 5)
      });

      this.logger.debug('Database transaction completed successfully');

      return result;
    } catch (error) {
      // Preserve HTTP exceptions (BadRequestException, NotFoundException, etc.)
      // so that specific error messages are returned to the client
      if (error instanceof HttpException) {
        this.logger.debug(
          `Re-throwing HTTP exception from transaction: ${error.message}`,
        );
        throw error;
      }

      this.logger.error('Database transaction failed', (error as Error).stack);
      throw new DatabaseException('Transaction failed');
    }
  }

  // Soft delete helper
  async softDelete(model: string, id: string): Promise<void> {
    await this.safeQuery(
      () =>
        (this as any)[model].update({
          where: { id },
          data: { deletedAt: new Date() },
        }),
      `soft delete ${model} with id ${id}`,
    );
  }

  // Soft delete query helper
  async findManyNotDeleted(model: string, options?: any) {
    // Normalize email in where clause to lowercase for consistency
    const normalizedWhere = options?.where
      ? this.normalizeEmailInWhere(options.where)
      : {};

    return this.safeQuery(
      () =>
        (this as any)[model].findMany({
          where: {
            ...normalizedWhere,
            deletedAt: null, // Always enforce soft-delete filter
          },
          // Spread other options (include, select, etc.) but exclude where
          ...(options && {
            ...Object.fromEntries(
              Object.entries(options).filter(([key]) => key !== 'where'),
            ),
          }),
        }),
      `find many ${model} (not deleted)`,
    );
  }

  /**
   * Helper to normalize email to lowercase for queries
   * Since emails are stored in lowercase, we normalize input for consistency
   */
  private normalizeEmailInWhere(where: any): any {
    if (!where || typeof where !== 'object') {
      return where;
    }

    const normalizedWhere = { ...where };

    // Normalize email field to lowercase if it's a string
    if (normalizedWhere.email !== undefined) {
      const emailValue = normalizedWhere.email;

      if (typeof emailValue === 'string') {
        normalizedWhere.email = emailValue.toLowerCase().trim();
      } else if (
        typeof emailValue === 'object' &&
        emailValue.equals &&
        typeof emailValue.equals === 'string'
      ) {
        // Handle Prisma query object format
        normalizedWhere.email = {
          ...emailValue,
          equals: emailValue.equals.toLowerCase().trim(),
        };
      }
    }

    // Handle nested OR conditions
    if (normalizedWhere.OR && Array.isArray(normalizedWhere.OR)) {
      normalizedWhere.OR = normalizedWhere.OR.map((condition: any) =>
        this.normalizeEmailInWhere(condition),
      );
    }

    // Handle nested AND conditions
    if (normalizedWhere.AND && Array.isArray(normalizedWhere.AND)) {
      normalizedWhere.AND = normalizedWhere.AND.map((condition: any) =>
        this.normalizeEmailInWhere(condition),
      );
    }

    return normalizedWhere;
  }

  async findUniqueNotDeleted(model: string, where: any, options?: any) {
    // Normalize email in where clause to lowercase for consistency
    const normalizedWhere = this.normalizeEmailInWhere(where);

    return this.safeQuery(
      () =>
        (this as any)[model].findFirst({
          where: {
            ...normalizedWhere,
            ...(options?.where
              ? this.normalizeEmailInWhere(options.where)
              : {}),
            deletedAt: null, // Always enforce soft-delete filter
          },
          // Spread other options (include, select, etc.) but exclude where
          ...(options && {
            ...Object.fromEntries(
              Object.entries(options).filter(([key]) => key !== 'where'),
            ),
          }),
        }),
      `find unique ${model} (not deleted)`,
    );
  }
}