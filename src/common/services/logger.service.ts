import { Logger } from '@nestjs/common';

export class LoggerService {
  private logger: Logger;
  private context: string;

  constructor(context?: string) {
    this.context = context || 'Application';
    this.logger = new Logger(this.context);
  }

  setContext(context: string): this {
    this.context = context;
    this.logger = new Logger(context);
    return this;
  }

  log(message: string, ...optionalParams: any[]): void {
    this.logger.log(message, ...optionalParams);
  }

  error(message: string, trace?: string, context?: string): void {
    this.logger.error(message, trace, context || this.context);
  }

  warn(message: string, ...optionalParams: any[]): void {
    this.logger.warn(message, ...optionalParams);
  }

  debug(message: string, ...optionalParams: any[]): void {
    this.logger.debug(message, ...optionalParams);
  }

  verbose(message: string, ...optionalParams: any[]): void {
    this.logger.verbose(message, ...optionalParams);
  }
}