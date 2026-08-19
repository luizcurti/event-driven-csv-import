import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { AppDependencies } from '../../shared/dependencies.js';
import { createAwsDependencies } from '../../shared/dependencies.js';
import { runRestHandler } from '../../shared/http.js';
import { withMetrics } from '../../shared/metrics.js';
import { createStatusHandler } from './handler.js';

/**
 * Real AWS Lambda entrypoint for the API Gateway REST routes:
 * `GET /imports` (no path parameter) and `GET /imports/{id}`.
 */
export const createStatusEntryHandler = (dependencies: AppDependencies) => {
  const statusHandler = createStatusHandler(dependencies);

  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> =>
    runRestHandler(() => statusHandler(event.pathParameters?.id));
};

export const handler = withMetrics(
  'status',
  createStatusEntryHandler(createAwsDependencies({}, process.env, 'status')),
);
