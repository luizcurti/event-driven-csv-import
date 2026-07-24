import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { AppDependencies } from '../../shared/dependencies.js';
import { ImportNotFoundException } from '../../shared/errors.js';
import { toJsonResponse } from '../../shared/http.js';

export const createStatusHandler = ({ store }: AppDependencies) => {
  return async (importId?: string): Promise<APIGatewayProxyStructuredResultV2> => {
    if (importId) {
      const currentImport = await store.getImport(importId);
      if (!currentImport) {
        throw new ImportNotFoundException();
      }

      return toJsonResponse(200, currentImport);
    }

    return toJsonResponse(200, {
      items: await store.listImports(),
    });
  };
};