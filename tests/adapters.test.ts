import { Readable } from 'node:stream';
import { describe, expect, it, jest } from '@jest/globals';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { createAwsClients } from '../shared/aws-clients.js';
import {
  createDependencies,
  createAwsDependencies,
} from '../shared/dependencies.js';
import { InMemoryImportStore } from '../shared/repository.js';
import {
  InMemoryObjectStorage,
  buildObjectKey,
} from '../shared/object-storage.js';
import { S3ObjectStorage } from '../shared/s3-object-storage.js';
import { DynamoDbImportStore } from '../shared/dynamodb-import-store.js';
import type { ImportRecord } from '../shared/types.js';

/** Minimal fake DynamoDB table keyed by `pk#sk`, faithful enough to exercise
 * the conditional/partial UpdateExpression logic in DynamoDbImportStore. */
const createFakeTable = () => {
  const items = new Map<string, Record<string, unknown>>();

  const applySetClauses = (
    item: Record<string, unknown>,
    names: Record<string, string>,
    values: Record<string, unknown>,
  ): Record<string, unknown> => {
    const updated = { ...item };
    for (const [nameToken, field] of Object.entries(names)) {
      const valueToken = `:v${nameToken.slice(2)}`;
      updated[field] = values[valueToken];
    }
    return updated;
  };

  const send = jest.fn(async (command: unknown) => {
    const name = (command as { constructor?: { name?: string } }).constructor
      ?.name;
    const input = (command as { input?: Record<string, unknown> }).input ?? {};

    if (name === 'PutCommand') {
      const item = input.Item as Record<string, unknown>;
      items.set(`${item.pk as string}#${item.sk as string}`, item);
      return {};
    }

    if (name === 'GetCommand') {
      const key = input.Key as { pk: string; sk: string };
      return { Item: items.get(`${key.pk}#${key.sk}`) };
    }

    if (name === 'ScanCommand') {
      return {
        Items: Array.from(items.values()).filter(
          (item) => item.entityType === 'IMPORT',
        ),
      };
    }

    if (name === 'QueryCommand') {
      const pk = (input.ExpressionAttributeValues as Record<string, unknown>)[
        ':pk'
      ] as string;
      return {
        Items: Array.from(items.values()).filter(
          (item) => item.pk === pk && item.entityType === 'CHUNK_RESULT',
        ),
      };
    }

    if (name === 'UpdateCommand') {
      const key = input.Key as { pk: string; sk: string };
      const itemKey = `${key.pk}#${key.sk}`;
      const existing = items.get(itemKey);

      if (!existing) {
        throw new ConditionalCheckFailedException({
          message: 'The conditional request failed',
          $metadata: {},
        });
      }

      if ((input.UpdateExpression as string).startsWith('ADD ')) {
        const increment =
          (input.ExpressionAttributeValues as Record<string, number>)[
            ':increment'
          ] ?? 0;
        const updated = {
          ...existing,
          processedChunks: Number(existing.processedChunks ?? 0) + increment,
          updatedAt: (
            input.ExpressionAttributeValues as Record<string, unknown>
          )[':updatedAt'],
        };
        items.set(itemKey, updated);
        return { Attributes: { processedChunks: updated.processedChunks } };
      }

      const updated = applySetClauses(
        existing,
        input.ExpressionAttributeNames as Record<string, string>,
        input.ExpressionAttributeValues as Record<string, unknown>,
      );
      items.set(itemKey, updated);
      return { Attributes: updated };
    }

    return {};
  });

  return { send, items };
};

describe('adapter coverage', () => {
  it('covers AWS client wiring and dependency factories', () => {
    const baseClients = createAwsClients({ region: 'us-east-1' });
    const localClients = createAwsClients({
      region: 'us-east-1',
      endpoint: 'http://localhost:4566',
    });

    expect(baseClients.s3).toBeDefined();
    expect(localClients.s3).toBeDefined();
    expect(localClients.dynamoDb).toBeDefined();
    expect(localClients.eventBridge).toBeDefined();
    expect(localClients.stepFunctions).toBeDefined();

    const defaultDependencies = createDependencies();
    expect(defaultDependencies.store).toBeInstanceOf(InMemoryImportStore);
    expect(defaultDependencies.storage).toBeInstanceOf(InMemoryObjectStorage);

    const overriddenDependencies = createAwsDependencies(
      {
        logger: defaultDependencies.logger,
        store: defaultDependencies.store,
        storage: defaultDependencies.storage,
      },
      {
        NODE_ENV: 'production',
        IMPORTS_BUCKET: 'imports-bucket',
        IMPORTS_TABLE_NAME: 'imports-table',
        AWS_REGION: 'us-east-1',
      },
    );

    expect(overriddenDependencies.store).toBe(defaultDependencies.store);
    expect(overriddenDependencies.storage).toBe(defaultDependencies.storage);
  });

  it('covers S3 object storage branches', async () => {
    const send = jest.fn(async (command: unknown) => {
      const name = (command as { constructor?: { name?: string } }).constructor
        ?.name;

      if (name === 'PutObjectCommand') {
        return {};
      }

      if (name === 'GetObjectCommand') {
        const input = (command as { input?: { Key?: string } }).input;
        const key = input?.Key ?? '';

        if (key === 'string.csv') {
          return {
            Body: 'string-body',
            ContentType: 'text/csv',
            Metadata: { importId: 'import-1' },
          };
        }

        if (key === 'bytes.csv') {
          return {
            Body: new Uint8Array(Buffer.from('bytes-body')),
            ContentType: 'text/csv',
          };
        }

        if (key === 'stream.csv') {
          return { Body: Readable.from([Buffer.from('stream-body')]) };
        }

        if (key === 'string-stream.csv') {
          return { Body: Readable.from(['string-stream-body']) };
        }

        if (key === 'empty.csv') {
          return { Body: undefined };
        }

        return { Body: 42 };
      }

      if (name === 'ListObjectsV2Command') {
        const input = (command as { input?: { Prefix?: string } }).input;
        if (input?.Prefix === 'processed/') {
          return { Contents: [{ Key: 'processed/file.csv' }, {}] };
        }

        return {};
      }

      return {};
    });

    const storage = new S3ObjectStorage({ send } as never, 'bucket-a');
    await storage.putObject({
      bucket: 'bucket-a',
      key: 'incoming/file.csv',
      body: 'csv',
      contentType: 'text/csv',
      metadata: { importId: 'import-1' },
    });
    expect(send).toHaveBeenCalledWith(expect.any(PutObjectCommand));
    expect(await storage.getObject('bucket-a', 'string.csv')).toMatchObject({
      body: 'string-body',
    });
    expect(await storage.getObject('bucket-a', 'bytes.csv')).toMatchObject({
      body: 'bytes-body',
    });
    expect(await storage.getObject('bucket-a', 'stream.csv')).toMatchObject({
      body: 'stream-body',
      contentType: 'application/octet-stream',
    });
    expect(
      await storage.getObject('bucket-a', 'string-stream.csv'),
    ).toMatchObject({
      body: 'string-stream-body',
      contentType: 'application/octet-stream',
    });
    expect(await storage.getObject('bucket-a', 'empty.csv')).toBeUndefined();
    expect(await storage.getObject('bucket-a', 'invalid.csv')).toBeUndefined();
    await storage.moveObject('bucket-a', 'string.csv', 'bucket-a', 'moved.csv');
    await storage.moveObject('bucket-a', 'bytes.csv', 'bucket-b', 'copied.csv');
    await storage.moveObject(
      'bucket-a',
      'missing.csv',
      'bucket-b',
      'missing-copy.csv',
    );
    expect(await storage.listObjects('bucket-a', 'processed/')).toEqual([
      expect.objectContaining({ key: 'processed/file.csv' }),
    ]);
    expect(await storage.listObjects('bucket-a', 'missing/')).toEqual([]);
    expect(buildObjectKey('bucket-a', 'key.csv')).toBe('bucket-a/key.csv');
  });

  it('covers DynamoDB import store branches', async () => {
    const { send } = createFakeTable();
    const store = new DynamoDbImportStore({ send } as never, 'imports-table');
    const now = new Date().toISOString();
    const importRecord: ImportRecord = {
      id: 'import-1',
      correlationId: 'correlation-1',
      filename: 'customers.csv',
      bucket: 'bucket-a',
      key: 'incoming/import-1/customers.csv',
      status: 'UPLOADED',
      createdAt: now,
      updatedAt: now,
      totalChunks: 2,
      processedChunks: 0,
      totalRecords: 0,
      processedRecords: 0,
      failedRecords: 0,
      successRecords: 0,
      chunkSize: 1,
      executionTimeMs: 10,
    };

    await store.saveImport(importRecord);
    expect(await store.getImport('import-1')).toEqual(importRecord);
    expect(await store.listImports()).toEqual([importRecord]);
    expect(await store.getImport('missing')).toBeUndefined();
    expect(
      await store.updateImport('missing', { status: 'FAILED' }),
    ).toBeUndefined();

    const updatedImport = await store.updateImport('import-1', {
      status: 'PROCESSING',
      processedChunks: 1,
    });
    expect(updatedImport).toMatchObject({
      status: 'PROCESSING',
      processedChunks: 1,
    });

    const compactImport: ImportRecord = {
      id: 'import-2',
      correlationId: 'correlation-2',
      filename: 'compact.csv',
      bucket: 'bucket-a',
      key: 'incoming/import-2/compact.csv',
      status: 'UPLOADED',
      createdAt: now,
      updatedAt: now,
      totalChunks: 0,
      processedChunks: 0,
      totalRecords: 0,
      processedRecords: 0,
      failedRecords: 0,
      successRecords: 0,
      chunkSize: 1,
    };

    await store.saveImport(compactImport);
    expect(await store.getImport('import-2')).toMatchObject({
      id: 'import-2',
      filename: 'compact.csv',
    });

    const firstSave = await store.saveChunkResult({
      importId: 'import-1',
      chunkNumber: 2,
      workerId: 'worker-2',
      requestId: 'request-2',
      status: 'COMPLETED',
      recordsProcessed: 1,
      successRecords: 1,
      failedRecords: 0,
      errors: [],
      durationMs: 5,
      correlationId: 'correlation-1',
    });
    expect(firstSave).toEqual({ isNewChunk: true });

    const redelivery = await store.saveChunkResult({
      importId: 'import-1',
      chunkNumber: 2,
      workerId: 'worker-2-retry',
      requestId: 'request-2-retry',
      status: 'COMPLETED',
      recordsProcessed: 1,
      successRecords: 1,
      failedRecords: 0,
      errors: [],
      durationMs: 5,
      correlationId: 'correlation-1',
    });
    expect(redelivery).toEqual({ isNewChunk: false });

    await store.saveChunkResult({
      importId: 'import-1',
      chunkNumber: 1,
      workerId: 'worker-1',
      requestId: 'request-1',
      status: 'PARTIAL_SUCCESS',
      recordsProcessed: 2,
      successRecords: 1,
      failedRecords: 1,
      errors: ['2'],
      durationMs: 7,
      correlationId: 'correlation-1',
    });

    expect(await store.listChunkResults('import-1')).toEqual([
      expect.objectContaining({ chunkNumber: 1 }),
      expect.objectContaining({ chunkNumber: 2 }),
    ]);

    expect(await store.incrementProcessedChunks('import-1')).toBe(2);
    expect(await store.incrementProcessedChunks('import-1')).toBe(3);
  });

  it('propagates unexpected updateImport errors instead of swallowing them', async () => {
    const send = jest.fn(async (command: unknown) => {
      const name = (command as { constructor?: { name?: string } }).constructor
        ?.name;
      if (name === 'UpdateCommand') {
        throw new Error('network blip');
      }
      return {};
    });

    const store = new DynamoDbImportStore({ send } as never, 'imports-table');
    await expect(
      store.updateImport('import-1', { status: 'FAILED' }),
    ).rejects.toThrow('network blip');
  });

  it('defaults incrementProcessedChunks to 0 when DynamoDB returns no attributes', async () => {
    const send = jest.fn(async () => ({}));
    const store = new DynamoDbImportStore({ send } as never, 'imports-table');
    expect(await store.incrementProcessedChunks('import-1')).toBe(0);
  });

  it('covers DynamoDB defaults and empty responses', async () => {
    const send = jest.fn(async (command: unknown) => {
      const name = (command as { constructor?: { name?: string } }).constructor
        ?.name;

      if (name === 'GetCommand') {
        return {
          Item: {
            pk: 'IMPORT#import-9',
            sk: 'META',
            id: 'import-9',
            correlationId: 'correlation-9',
            filename: 'partial.csv',
            bucket: 'bucket-a',
            key: 'incoming/import-9/partial.csv',
            status: 'UPLOADED',
            createdAt: '2026-07-20T00:00:00.000Z',
            updatedAt: '2026-07-20T00:00:00.000Z',
          },
        };
      }

      if (name === 'ScanCommand') {
        return { Items: undefined };
      }

      if (name === 'QueryCommand') {
        return { Items: undefined };
      }

      if (name === 'PutCommand') {
        return {};
      }

      return {};
    });

    const store = new DynamoDbImportStore({ send } as never, 'imports-table');

    expect(await store.getImport('import-9')).toMatchObject({
      id: 'import-9',
      totalChunks: 0,
      processedChunks: 0,
      totalRecords: 0,
      processedRecords: 0,
      failedRecords: 0,
      successRecords: 0,
      chunkSize: 0,
    });
    expect(await store.listImports()).toEqual([]);
    expect(await store.listChunkResults('import-9')).toEqual([]);
  });

  it('covers DynamoDB empty arrays explicitly', async () => {
    const send = jest.fn(async (command: unknown) => {
      const name = (command as { constructor?: { name?: string } }).constructor
        ?.name;

      if (name === 'ScanCommand') {
        return { Items: [] };
      }

      if (name === 'QueryCommand') {
        return { Items: [] };
      }

      return {};
    });

    const store = new DynamoDbImportStore({ send } as never, 'imports-table');

    expect(await store.listImports()).toEqual([]);
    expect(await store.listChunkResults('import-9')).toEqual([]);
  });

  it('covers DynamoDB chunk fallbacks', async () => {
    const send = jest.fn(async (command: unknown) => {
      const name = (command as { constructor?: { name?: string } }).constructor
        ?.name;

      if (name === 'QueryCommand') {
        return {
          Items: [{}],
        };
      }

      return {};
    });

    const store = new DynamoDbImportStore({ send } as never, 'imports-table');

    expect(await store.listChunkResults('import-10')).toEqual([
      expect.objectContaining({
        importId: '',
        chunkNumber: 0,
        workerId: '',
        requestId: '',
        errors: [],
        durationMs: 0,
        correlationId: '',
      }),
    ]);
  });
});
