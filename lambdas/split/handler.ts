import type { AppDependencies } from '../../shared/dependencies.js';
import { ImportNotFoundException } from '../../shared/errors.js';
import { splitCsvIntoChunks } from '../../shared/csv.js';
import type { ChunkMessage, ImportRecord } from '../../shared/types.js';

export interface SplitResult {
  importId: string;
  totalChunks: number;
  messages: ChunkMessage[];
}

export const createSplitHandler = ({ config, logger, store, storage }: AppDependencies) => {
  return async (importId: string): Promise<SplitResult> => {
    const currentImport = await store.getImport(importId);
    if (!currentImport) {
      throw new ImportNotFoundException();
    }

    const object = await storage.getObject(currentImport.bucket, currentImport.key);
    if (!object) {
      throw new ImportNotFoundException('Source CSV not found in storage.');
    }

    const chunks = splitCsvIntoChunks(object.body, currentImport.chunkSize ?? config.chunkSize);
    const messages: ChunkMessage[] = [];

    await store.updateImport(importId, {
      status: 'SPLITTING',
      totalChunks: chunks.length,
      totalRecords: Math.max(chunks.reduce((sum, chunk) => sum + chunk.records, 0), 0),
    } satisfies Partial<ImportRecord>);

    for (const chunk of chunks) {
      const key = `processing/${importId}/chunk-${String(chunk.chunkNumber).padStart(4, '0')}.csv`;
      await storage.putObject({
        bucket: currentImport.bucket,
        key,
        body: chunk.content,
        contentType: 'text/csv',
        metadata: {
          importId,
          chunkNumber: String(chunk.chunkNumber),
          correlationId: currentImport.correlationId,
        },
      });

      messages.push({
        importId,
        chunkNumber: chunk.chunkNumber,
        bucket: currentImport.bucket,
        key,
        totalChunks: chunks.length,
        correlationId: currentImport.correlationId,
      });
    }

    logger.info('Import split completed', {
      importId,
      totalChunks: chunks.length,
      status: chunks.length ? 'QUEUED' : 'FAILED',
    });

    await store.updateImport(importId, {
      status: chunks.length ? 'QUEUED' : 'FAILED',
    } satisfies Partial<ImportRecord>);

    return {
      importId,
      totalChunks: chunks.length,
      messages,
    };
  };
};