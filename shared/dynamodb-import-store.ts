import {
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import type { ChunkResult, ImportRecord } from './types.js';
import type { ImportStore } from './repository.js';

type TableItem = ImportRecord & {
  pk: string;
  sk: string;
  entityType: 'IMPORT' | 'CHUNK_RESULT';
};

const importPk = (id: string): string => `IMPORT#${id}`;
const importSk = 'META';
const chunkSk = (chunkNumber: number): string => `CHUNK#${String(chunkNumber).padStart(6, '0')}`;

const toImportItem = (record: ImportRecord): TableItem => ({
  ...record,
  pk: importPk(record.id),
  sk: importSk,
  entityType: 'IMPORT',
});

const toChunkItem = (result: ChunkResult): TableItem => ({
  id: `${result.importId}:${result.chunkNumber}`,
  correlationId: result.correlationId,
  filename: '',
  bucket: '',
  key: '',
  status: result.status,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  totalChunks: 0,
  processedChunks: 0,
  totalRecords: 0,
  processedRecords: result.recordsProcessed,
  failedRecords: result.failedRecords,
  successRecords: result.successRecords,
  executionTimeMs: result.durationMs,
  chunkSize: 0,
  pk: importPk(result.importId),
  sk: chunkSk(result.chunkNumber),
  entityType: 'CHUNK_RESULT',
  workerId: result.workerId,
  requestId: result.requestId,
  recordsProcessed: result.recordsProcessed,
  errors: result.errors,
  durationMs: result.durationMs,
  chunkNumber: result.chunkNumber,
} as TableItem & {
  workerId: string;
  requestId: string;
  recordsProcessed: number;
  errors: string[];
  durationMs: number;
  chunkNumber: number;
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