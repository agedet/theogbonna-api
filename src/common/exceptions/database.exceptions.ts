import { HttpException } from '@nestjs/common';

export class DatabaseException extends HttpException {
  constructor(message: string, statusCode: number = 500) {
    super(message, statusCode);
  }
}

export class EntityNotFoundException extends DatabaseException {
  constructor(entityName: string, id: string) {
    super(`${entityName} with id ${id} not found`, 404);
  }
}