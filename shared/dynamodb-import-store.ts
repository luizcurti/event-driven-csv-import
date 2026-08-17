import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import type { ChunkResult, ImportRecord } from './types.js';
import type { ImportStore, SaveChunkResultOutcome } from './repository.js';

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

  /**
   * Updates only the given fields via a DynamoDB partial UpdateExpression
   * instead of a get-modify-put of the whole item. A get-modify-put would let
   * a concurrent Worker's `incrementProcessedChunks` (or another concurrent
   * `updateImport`) land between our read and write and get silently
   * overwritten by our stale copy of the item.
   */
  async updateImport(id: string, patch: Partial<ImportRecord>): Promise<ImportRecord | undefined> {
    const entries = Object.entries({ ...patch, updatedAt: new Date().toISOString() });

    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, unknown> = {};
    const setClauses = entries.map(([key, value], index) => {
      const nameToken = `#f${index}`;
      const valueToken = `:v${index}`;
      expressionAttributeNames[nameToken] = key;
      expressionAttributeValues[valueToken] = value;
      return `${nameToken} = ${valueToken}`;
    });

    try {
      const response = await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk: importPk(id), sk: importSk },
          UpdateExpression: `SET ${setClauses.join(', ')}`,
          ConditionExpression: 'attribute_exists(pk)',
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: expressionAttributeValues,
          ReturnValues: 'ALL_NEW',
        }),
      );

      return fromImportItem(response.Attributes!);
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return undefined;
      }

      throw error;
    }
  }

  /**
   * Reports whether the chunk was already recorded so the caller only
   * increments the processed-chunk counter once per distinct chunk, even if
   * an SQS redelivery causes the same chunk to be processed more than once.
   */
  async saveChunkResult(result: ChunkResult): Promise<SaveChunkResultOutcome> {
    const existing = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: importPk(result.importId),
          sk: chunkSk(result.chunkNumber),
        },
      }),
    );

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: toChunkItem(result),
      }),
    );

    return { isNewChunk: !existing.Item };
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

  /**
   * Atomic DynamoDB `ADD` so two Workers finishing different chunks at
   * nearly the same time each get a distinct, correct counter value back —
   * neither can observe a stale count and both decide they're "last".
   */
  async incrementProcessedChunks(importId: string): Promise<number> {
    const response = await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: importPk(importId), sk: importSk },
        UpdateExpression: 'ADD processedChunks :increment SET updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':increment': 1,
          ':updatedAt': new Date().toISOString(),
        },
        ReturnValues: 'UPDATED_NEW',
      }),
    );

    return Number(response.Attributes?.processedChunks ?? 0);
  }
}