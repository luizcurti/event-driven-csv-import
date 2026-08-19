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

    // The Aggregator is the source of truth for "is this import actually
    // done" — it must not finalize a status while chunks are still
    // outstanding, even if it gets invoked early (a race between concurrent
    // Workers) or replayed after the fact.
    if (
      currentImport.totalChunks === 0 ||
      chunkResults.length < currentImport.totalChunks
    ) {
      logger.warn('Aggregation skipped: import still has pending chunks', {
        importId,
        totalChunks: currentImport.totalChunks,
        processedChunks: chunkResults.length,
      });

      return {
        importId,
        status: currentImport.status,
        processedRecords: currentImport.processedRecords,
        successRecords: currentImport.successRecords,
        failedRecords: currentImport.failedRecords,
        totalChunks: currentImport.totalChunks,
        processedChunks: chunkResults.length,
        executionTimeMs: currentImport.executionTimeMs ?? 0,
      };
    }

    const processedRecords = chunkResults.reduce(
      (sum, result) => sum + result.recordsProcessed,
      0,
    );
    const successRecords = chunkResults.reduce(
      (sum, result) => sum + result.successRecords,
      0,
    );
    const failedRecords = chunkResults.reduce(
      (sum, result) => sum + result.failedRecords,
      0,
    );
    const processedChunks = chunkResults.length;
    const completedStatus =
      failedRecords === 0
        ? 'COMPLETED'
        : successRecords === 0
          ? 'FAILED'
          : 'PARTIAL_SUCCESS';
    const executionTimeMs =
      Date.now() - new Date(currentImport.createdAt).getTime();

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
