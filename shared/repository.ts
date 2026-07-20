import type { ChunkResult, ImportRecord } from './types.js';

export interface ImportStore {
  saveImport(record: ImportRecord): Promise<void>;
  getImport(id: string): Promise<ImportRecord | undefined>;
  listImports(): Promise<ImportRecord[]>;
  updateImport(id: string, patch: Partial<ImportRecord>): Promise<ImportRecord | undefined>;
  saveChunkResult(result: ChunkResult): Promise<void>;
  listChunkResults(importId: string): Promise<ChunkResult[]>;
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

  async updateImport(id: string, patch: Partial<ImportRecord>): Promise<ImportRecord | undefined> {
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

  async saveChunkResult(result: ChunkResult): Promise<void> {
    const results = this.chunkResults.get(result.importId) ?? [];
    const filtered = results.filter((current) => current.chunkNumber !== result.chunkNumber);
    filtered.push({ ...result });
    filtered.sort((left, right) => left.chunkNumber - right.chunkNumber);
    this.chunkResults.set(result.importId, filtered);
  }

  async listChunkResults(importId: string): Promise<ChunkResult[]> {
    return (this.chunkResults.get(importId) ?? []).map((result) => ({ ...result }));
  }
}