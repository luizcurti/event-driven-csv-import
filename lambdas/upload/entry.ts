import type { APIGatewayProxyEvent, APIGatewayProxyEventV2, APIGatewayProxyResult } from 'aws-lambda';
import type { AppDependencies } from '../../shared/dependencies.js';
import { createAwsDependencies } from '../../shared/dependencies.js';
import { toErrorResponse } from '../../shared/http.js';
import { createUploadHandler } from './handler.js';

/**
 * Real AWS Lambda entrypoint. Adapts the API Gateway (REST, payload v1) proxy
 * event into the handler contract and wires production dependencies.
 * Only fields shared by v1/v2 proxy events (`headers`, `body`, `isBase64Encoded`)
 * are used by the handler, so the v1 event is forwarded as-is.
 * Thrown errors are converted into proper HTTP error responses so API Gateway
 * clients receive a meaningful status code and body instead of a generic 500.
 */
export const createUploadEntryHandler = (dependencies: AppDependencies) => {
  const uploadHandler = createUploadHandler(dependencies);

  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
      const response = await uploadHandler(event as unknown as APIGatewayProxyEventV2);
      return response as unknown as APIGatewayProxyResult;
    } catch (error) {
      return toErrorResponse(error) as unknown as APIGatewayProxyResult;
    }
  };
};

export const handler = createUploadEntryHandler(createAwsDependencies());
