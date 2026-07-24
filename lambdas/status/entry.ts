import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { AppDependencies } from '../../shared/dependencies.js';
import { createAwsDependencies } from '../../shared/dependencies.js';
import { toErrorResponse } from '../../shared/http.js';
import { createStatusHandler } from './handler.js';

/**
 * Real AWS Lambda entrypoint for the API Gateway REST routes:
 * `GET /imports` (no path parameter) and `GET /imports/{id}`.
 * Thrown errors are converted into proper HTTP error responses so API Gateway
 * clients receive a meaningful status code and body instead of a generic 500.
 */
export const createStatusEntryHandler = (dependencies: AppDependencies) => {
  const statusHandler = createStatusHandler(dependencies);

  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
      const response = await statusHandler(event.pathParameters?.id);
      return response as unknown as APIGatewayProxyResult;
    } catch (error) {
      return toErrorResponse(error) as unknown as APIGatewayProxyResult;
    }
  };
};

export const handler = createStatusEntryHandler(createAwsDependencies());
