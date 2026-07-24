import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { AppError } from './errors.js';

export const toJsonResponse = (statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: {
    'content-type': 'application/json',
  },
  body: JSON.stringify(body),
});

/**
 * Converts a thrown error into an API Gateway proxy response. `AppError` instances
 * (and subclasses) carry their own HTTP status code and machine-readable code; any
 * other thrown value is treated as an unexpected failure and mapped to a generic 500
 * so callers never see a raw Lambda invocation error or internal error details.
 */
export const toErrorResponse = (error: unknown): APIGatewayProxyStructuredResultV2 => {
  if (error instanceof AppError) {
    return toJsonResponse(error.statusCode, { message: error.message, code: error.code });
  }

  return toJsonResponse(500, { message: 'Internal server error.', code: 'INTERNAL_ERROR' });
};
