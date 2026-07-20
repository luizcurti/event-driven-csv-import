import type { AppDependencies } from '../../shared/dependencies.js';
import { ImportNotFoundException } from '../../shared/errors.js';
import type { ImportRecord } from '../../shared/types.js';

export interface AggregationResult {
  importId: string;
  status: ImportRecord['status'];
  processedRecords: number;
  successRecords: number;
  failedRecords: number;
  totalChunks: number;
  processedChunks: number;
  executionTimeMs: number;
}

export const createAggregatorHandler = ({ logger, store }: AppDependencies) => {
  return async (importId: string): Promise<AggregationResult> => {
    const currentImport = await store.getImport(importId);
    if (!currentImport) {
      throw new ImportNotFoundException();
    }

    const chunkResults = await store.listChunkResults(importId);
    const processedRecords = chunkResults.reduce((sum, result) => sum + result.recordsProcessed, 0);
    const successRecords = chunkResults.reduce((sum, result) => sum + result.successRecords, 0);
    const failedRecords = chunkResults.reduce((sum, result) => sum + result.failedRecords, 0);
    const processedChunks = chunkResults.length;
    const completedStatus = failedRecords === 0 ? 'COMPLETED' : successRecords === 0 ? 'FAILED' : 'PARTIAL_SUCCESS';
    const executionTimeMs = Date.now() - new Date(currentImport.createdAt).getTime();

    await store.updateImport(importId, {
      status: completedStatus,
      processedChunks,
      processedRecords,
      successRecords,
      failedRecords,
      executionTimeMs,
    } satisfies Partial<ImportRecord>);

    logger.info('Import aggregated', {
      importId,
      status: completedStatus,
      processedRecords,
      successRecords,
      failedRecords,
      totalChunks: currentImport.totalChunks,
      processedChunks,
      executionTimeMs,
    });

    return {
      importId,
      status: completedStatus,
      processedRecords,
      successRecords,
      failedRecords,
      totalChunks: currentImport.totalChunks,
      processedChunks,
      executionTimeMs,
    };
  };
};