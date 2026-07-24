import type { AppDependencies } from '../../shared/dependencies.js';
import { ChunkProcessingException } from '../../shared/errors.js';
import { createId } from '../../shared/events.js';
import { mapCsvRowsToCustomerRecords, parseCsvText } from '../../shared/csv.js';
import { validateCustomerRecord } from '../../shared/validation.js';
import type { ChunkMessage, ChunkResult, CustomerRecord, ImportRecord } from '../../shared/types.js';

export interface WorkerResult {
  importId: string;
  chunkNumber: number;
  result: ChunkResult;
  records: CustomerRecord[];
}

export const createWorkerHandler = ({ logger, store, storage }: AppDependencies) => {
  return async (message: ChunkMessage): Promise<WorkerResult> => {
    const startedAt = Date.now();
    const requestId = createId();
    const workerId = createId();

    const object = await storage.getObject(message.bucket, message.key);
    if (!object) {
      throw new ChunkProcessingException('Chunk object not found.');
    }

    const rows = parseCsvText(object.body);
    const records = mapCsvRowsToCustomerRecords(rows);
    const validatedRecords = records.map((record) => {
      const issues = validateCustomerRecord(record);
      return {
        ...record,
        status: issues.length ? 'INVALID' : 'VALID',
      } satisfies CustomerRecord;
    });

    const errors = validatedRecords.filter((record) => record.status === 'INVALID').map((record) => record.customerId);
    const successRecords = validatedRecords.length - errors.length;
    const status = errors.length === 0 ? 'COMPLETED' : successRecords > 0 ? 'PARTIAL_SUCCESS' : 'FAILED';

    const result: ChunkResult = {
      importId: message.importId,
      chunkNumber: message.chunkNumber,
      workerId,
      requestId,
      status,
      recordsProcessed: validatedRecords.length,
      successRecords,
      failedRecords: errors.length,
      errors,
      durationMs: Date.now() - startedAt,
      correlationId: message.correlationId,
    };

    await store.saveChunkResult(result);
    const chunkResults = await store.listChunkResults(message.importId);
    await store.updateImport(message.importId, {
      status: 'RUNNING',
      processedChunks: chunkResults.length,
      processedRecords: chunkResults.reduce((sum, current) => sum + current.recordsProcessed, 0),
      successRecords: chunkResults.reduce((sum, current) => sum + current.successRecords, 0),
      failedRecords: chunkResults.reduce((sum, current) => sum + current.failedRecords, 0),
    } satisfies Partial<ImportRecord>);

    logger.info('Chunk processed', {
      importId: message.importId,
      chunk: message.chunkNumber,
      workerId,
      requestId,
      durationMs: result.durationMs,
      status: result.status,
      recordsProcessed: result.recordsProcessed,
      errors: result.failedRecords,
    });

    return {
      importId: message.importId,
      chunkNumber: message.chunkNumber,
      result,
      records: validatedRecords,
    };
  };
};