import type { AppDependencies } from '../../shared/dependencies.js';
import { createAwsDependencies } from '../../shared/dependencies.js';
import { createAggregatorHandler, type AggregationResult } from './handler.js';

export interface AggregatorEntryInput {
  importId: string;
}

/**
 * Real AWS Lambda entrypoint. Invoked directly (async) by the Worker Lambda
 * once every chunk of an import has been processed.
 */
export const createAggregatorEntryHandler = (dependencies: AppDependencies) => {
  const aggregatorHandler = createAggregatorHandler(dependencies);
  return async (event: AggregatorEntryInput): Promise<AggregationResult> => aggregatorHandler(event.importId);
};

export const handler = createAggregatorEntryHandler(createAwsDependencies());
