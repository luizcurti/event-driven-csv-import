import type { APIGatewayProxyEvent, APIGatewayProxyEventV2, APIGatewayProxyResult } from 'aws-lambda';
import type { AppDependencies } from '../../shared/dependencies.js';
import { createAwsDependencies } from '../../shared/dependencies.js';
import { runRestHandler } from '../../shared/http.js';
import { withMetrics } from '../../shared/metrics.js';
import { createUploadHandler } from './handler.js';

/**
 * Real AWS Lambda entrypoint. Adapts the API Gateway (REST, payload v1) proxy
 * event into the handler contract and wires production dependencies.
 * Only fields shared by v1/v2 proxy events (`headers`, `body`, `isBase64Encoded`)
 * are used by the handler, so the v1 event is forwarded as-is.
 */
export const createUploadEntryHandler = (dependencies: AppDependencies) => {
  const uploadHandler = createUploadHandler(dependencies);

  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> =>
    runRestHandler(() => uploadHandler(event as unknown as APIGatewayProxyEventV2));
};

export const handler = withMetrics('upload', createUploadEntryHandler(createAwsDependencies({}, process.env, 'upload')));
