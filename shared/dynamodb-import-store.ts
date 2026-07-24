import {
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import type { ChunkResult, ImportRecord } from './types.js';
import type { ImportStore } from './repository.js';

type ImportTableItem = ImportRecord & {
  pk: string;
  sk: string;
  entityType: 'IMPORT';
};

type ChunkTableItem = ChunkResult & {
  pk: string;
  sk: string;
  entityType: 'CHUNK_RESULT';
};

const importPk = (id: string): string => `IMPORT#${id}`;
const importSk = 'META';
const chunkSk = (chunkNumber: number): string => `CHUNK#${String(chunkNumber).padStart(6, '0')}`;

const toImportItem = (record: ImportRecord): ImportTableItem => ({
  ...record,
  pk: importPk(record.id),
  sk: importSk,
  entityType: 'IMPORT',
});

const toChunkItem = (result: ChunkResult): ChunkTableItem => ({
  ...result,
  pk: importPk(result.importId),
  sk: chunkSk(result.chunkNumber),
  entityType: 'CHUNK_RESULT',
});

const fromImportItem = (item: Record<string, unknown>): ImportRecord => ({
  ...{
    id: String(item.id),
    correlationId: String(item.correlationId),
    filename: String(item.filename),
    bucket: String(item.bucket),
    key: String(item.key),
    status: item.status as ImportRecord['status'],
    createdAt: String(item.createdAt),
    updatedAt: String(item.updatedAt),
    totalChunks: Number(item.totalChunks ?? 0),
    processedChunks: Number(item.processedChunks ?? 0),
    totalRecords: Number(item.totalRecords ?? 0),
    processedRecords: Number(item.processedRecords ?? 0),
    failedRecords: Number(item.failedRecords ?? 0),
    successRecords: Number(item.successRecords ?? 0),
    chunkSize: Number(item.chunkSize ?? 0),
  },
  ...(typeof item.executionTimeMs === 'number' ? { executionTimeMs: item.executionTimeMs } : {}),
});

const fromChunkItem = (item: Record<string, unknown>): ChunkResult => ({
  importId: String(item.importId ?? String(item.pk ?? '').replace(/^IMPORT#/, '')),
  chunkNumber: Number(item.chunkNumber ?? 0),
  workerId: String(item.workerId ?? ''),
  requestId: String(item.requestId ?? ''),
  status: item.status as ChunkResult['status'],
  recordsProcessed: Number(item.recordsProcessed ?? 0),
  successRecords: Number(item.successRecords ?? 0),
  failedRecords: Number(item.failedRecords ?? 0),
  errors: Array.isArray(item.errors) ? item.errors.map(String) : [],
  durationMs: Number(item.durationMs ?? 0),
  correlationId: String(item.correlationId ?? ''),
});

export class DynamoDbImportStore implements ImportStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async saveImport(record: ImportRecord): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: toImportItem(record),
      }),
    );
  }

  async getImport(id: string): Promise<ImportRecord | undefined> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: importPk(id),
          sk: importSk,
        },
      }),
    );

    return response.Item ? fromImportItem(response.Item) : undefined;
  }

  async listImports(): Promise<ImportRecord[]> {
    const response = await this.client.send(
      new ScanCommand({
        TableName: this.tableName,
        FilterExpression: '#entityType = :entityType',
        ExpressionAttributeNames: {
          '#entityType': 'entityType',
        },
        ExpressionAttributeValues: {
          ':entityType': 'IMPORT',
        },
      }),
    );

    return (response.Items ?? []).map(fromImportItem);
  }

  async updateImport(id: string, patch: Partial<ImportRecord>): Promise<ImportRecord | undefined> {
    const current = await this.getImport(id);
    if (!current) {
      return undefined;
    }

    const updated = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    } satisfies ImportRecord;

    await this.saveImport(updated);
    return updated;
  }

  async saveChunkResult(result: ChunkResult): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: toChunkItem(result),
      }),
    );
  }

  async listChunkResults(importId: string): Promise<ChunkResult[]> {
    const response = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: '#pk = :pk and begins_with(#sk, :sk)',
        ExpressionAttributeNames: {
          '#pk': 'pk',
          '#sk': 'sk',
        },
        ExpressionAttributeValues: {
          ':pk': importPk(importId),
          ':sk': 'CHUNK#',
        },
      }),
    );

    return (response.Items ?? []).map(fromChunkItem).sort((left, right) => left.chunkNumber - right.chunkNumber);
  }
}