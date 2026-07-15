import { isLocalDevelopment } from './environment.util';

const ROUTING_NOT_FOUND_PATTERN =
  /^Cannot (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) /i;

const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const HTTP_SERVICE_UNAVAILABLE = 503;

const STATUS_MESSAGES: Partial<Record<number, string>> = {
  [HTTP_BAD_REQUEST]: 'Bad Request',
  [HTTP_UNAUTHORIZED]: 'Unauthorized',
  [HTTP_FORBIDDEN]: 'Forbidden',
  [HTTP_NOT_FOUND]: 'Not Found',
  [409]: 'Conflict',
  [429]: 'Too Many Requests',
  [HTTP_INTERNAL_SERVER_ERROR]: 'Internal server error',
  [HTTP_SERVICE_UNAVAILABLE]: 'Service temporarily unavailable',
};

function sanitizeMessage(
  status: number,
  message: string | string[],
  errors?: string[],
): string | string[] {
  if (status === HTTP_BAD_REQUEST && Array.isArray(errors)) {
    return 'Validation failed';
  }

  if (status === HTTP_NOT_FOUND) {
    return STATUS_MESSAGES[HTTP_NOT_FOUND]!;
  }

  if (status >= HTTP_INTERNAL_SERVER_ERROR) {
    return (
      STATUS_MESSAGES[status] ?? STATUS_MESSAGES[HTTP_INTERNAL_SERVER_ERROR]!
    );
  }

  if (status === HTTP_UNAUTHORIZED) {
    return STATUS_MESSAGES[HTTP_UNAUTHORIZED]!;
  }

  if (status === HTTP_FORBIDDEN) {
    return STATUS_MESSAGES[HTTP_FORBIDDEN]!;
  }

  if (typeof message === 'string') {
    if (ROUTING_NOT_FOUND_PATTERN.test(message)) {
      return STATUS_MESSAGES[HTTP_NOT_FOUND]!;
    }
    if (message.length > 0) {
      return message;
    }
  }

  return STATUS_MESSAGES[status] ?? 'An error occurred';
}

export interface ErrorResponseInput {
  status: number;
  message: string | string[];
  errors?: string[];
  path?: string;
  method?: string;
  stack?: string;
}

export function formatErrorResponse(
  input: ErrorResponseInput,
): Record<string, unknown> {
  const { status, message, errors, path, method, stack } = input;

  if (isLocalDevelopment()) {
    const response: Record<string, unknown> = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path,
      method,
      message: message || 'Internal server error',
    };

    if (errors?.length) {
      response.errors = errors;
    }

    if (stack) {
      response.stack = stack;
    }

    return response;
  }

  const response: Record<string, unknown> = {
    statusCode: status,
    message: sanitizeMessage(status, message, errors),
  };

  if (status === HTTP_BAD_REQUEST && Array.isArray(errors)) {
    response.errors = errors;
  }

  return response;
}