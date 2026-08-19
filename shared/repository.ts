import type { ChunkResult, ImportRecord } from './types.js';

export interface SaveChunkResultOutcome {
  isNewChunk: boolean;
}

export interface ImportStore {
  saveImport(record: ImportRecord): Promise<void>;
  getImport(id: string): Promise<ImportRecord | undefined>;
  listImports(): Promise<ImportRecord[]>;
  updateImport(
    id: string,
    patch: Partial<ImportRecord>,
  ): Promise<ImportRecord | undefined>;
  saveChunkResult(result: ChunkResult): Promise<SaveChunkResultOutcome>;
  listChunkResults(importId: string): Promise<ChunkResult[]>;
  /**
   * Atomically increments `processedChunks` and returns the new value. Callers
   * use this — instead of counting `listChunkResults()` and writing it back —
   * so that two Workers finishing different chunks at nearly the same time
   * can't both observe "all chunks done" and double-trigger the Aggregator.
   */
  incrementProcessedChunks(importId: string): Promise<number>;
}

export class InMemoryImportStore implements ImportStore {
  private readonly imports = new Map<string, ImportRecord>();

  private readonly chunkResults = new Map<string, ChunkResult[]>();

  async saveImport(record: ImportRecord): Promise<void> {
    this.imports.set(record.id, { ...record });
  }

  async getImport(id: string): Promise<ImportRecord | undefined> {
    const record = this.imports.get(id);
    return record ? { ...record } : undefined;
  }

  async listImports(): Promise<ImportRecord[]> {
    return Array.from(this.imports.values()).map((record) => ({ ...record }));
  }

  async updateImport(
    id: string,
    patch: Partial<ImportRecord>,
  ): Promise<ImportRecord | undefined> {
    const current = this.imports.get(id);
    if (!current) {
      return undefined;
    }

    const updated = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    } satisfies ImportRecord;

    this.imports.set(id, updated);
    return { ...updated };
  }

  async saveChunkResult(result: ChunkResult): Promise<SaveChunkResultOutcome> {
    const results = this.chunkResults.get(result.importId) ?? [];
    const isNewChunk = !results.some(
      (current) => current.chunkNumber === result.chunkNumber,
    );
    const filtered = results.filter(
      (current) => current.chunkNumber !== result.chunkNumber,
    );
    filtered.push({ ...result });
    filtered.sort((left, right) => left.chunkNumber - right.chunkNumber);
    this.chunkResults.set(result.importId, filtered);
    return { isNewChunk };
  }

  async listChunkResults(importId: string): Promise<ChunkResult[]> {
    return (this.chunkResults.get(importId) ?? []).map((result) => ({
      ...result,
    }));
  }

  async incrementProcessedChunks(importId: string): Promise<number> {
    const current = this.imports.get(importId);
    if (!current) {
      throw new Error(`Import "${importId}" not found.`);
    }

    const updated: ImportRecord = {
      ...current,
      processedChunks: current.processedChunks + 1,
      updatedAt: new Date().toISOString(),
    };

    this.imports.set(importId, updated);
    return updated.processedChunks;
  }
}
