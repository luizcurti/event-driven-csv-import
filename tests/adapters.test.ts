import { Readable } from 'node:stream';
import { describe, expect, it, jest } from '@jest/globals';
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { createAwsClients } from '../shared/aws-clients.js';
import { createDependencies, createAwsDependencies } from '../shared/dependencies.js';
import { InMemoryImportStore } from '../shared/repository.js';
import { InMemoryObjectStorage } from '../shared/object-storage.js';
import { S3ObjectStorage, createBucketObjectKey } from '../shared/s3-object-storage.js';
import { DynamoDbImportStore } from '../shared/dynamodb-import-store.js';
import type { ImportRecord } from '../shared/types.js';

describe('adapter coverage', () => {
  it('covers AWS client wiring and dependency factories', () => {
    const baseClients = createAwsClients({ region: 'us-east-1' });
    const localClients = createAwsClients({ region: 'us-east-1', endpoint: 'http://localhost:4566' });

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
      const name = (command as { constructor?: { name?: string } }).constructor?.name;

      if (name === 'PutObjectCommand') {
        return {};
      }

      if (name === 'GetObjectCommand') {
        const input = (command as { input?: { Key?: string } }).input;
        const key = input?.Key ?? '';

        if (key === 'string.csv') {
          return { Body: 'string-body', ContentType: 'text/csv', Metadata: { importId: 'import-1' } };
        }

        if (key === 'bytes.csv') {
          return { Body: new Uint8Array(Buffer.from('bytes-body')), ContentType: 'text/csv' };
        }

        if (key === 'stream.csv') {
          return { Body: Readable.from([Buffer.from('stream-body')]) };
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
    await storage.putObject({ bucket: 'bucket-a', key: 'incoming/file.csv', body: 'csv', contentType: 'text/csv', metadata: { importId: 'import-1' } });
    expect(send).toHaveBeenCalledWith(expect.any(PutObjectCommand));
    expect(await storage.getObject('bucket-a', 'string.csv')).toMatchObject({ body: 'string-body' });
    expect(await storage.getObject('bucket-a', 'bytes.csv')).toMatchObject({ body: 'bytes-body' });
    expect(await storage.getObject('bucket-a', 'stream.csv')).toMatchObject({ body: 'stream-body', contentType: 'application/octet-stream' });
    expect(await storage.getObject('bucket-a', 'empty.csv')).toBeUndefined();
    expect(await storage.getObject('bucket-a', 'invalid.csv')).toBeUndefined();
    await storage.moveObject('bucket-a', 'string.csv', 'bucket-a', 'moved.csv');
    await storage.moveObject('bucket-a', 'bytes.csv', 'bucket-b', 'copied.csv');
    expect(await storage.listObjects('bucket-a', 'processed/')).toEqual([expect.objectContaining({ key: 'processed/file.csv' })]);
    expect(await storage.listObjects('bucket-a', 'missing/')).toEqual([]);
    expect(createBucketObjectKey('bucket-a', 'key.csv')).toBe('bucket-a/key.csv');
  });

  it('covers DynamoDB import store branches', async () => {
    const storedImports = new Map<string, Record<string, unknown>>();
    const chunkResults: Record<string, unknown>[] = [];

    const send = jest.fn(async (command: unknown) => {
      const name = (command as { constructor?: { name?: string } }).constructor?.name;

      if (name === 'PutCommand') {
        const input = (command as { input?: { Item?: Record<string, unknown> } }).input;
        if (input?.Item?.entityType === 'IMPORT' && typeof input.Item.pk === 'string') {
          storedImports.set(input.Item.pk, input.Item);
        } else if (input?.Item?.entityType === 'CHUNK_RESULT') {
          chunkResults.push(input.Item);
        }
        return {};
      }

      if (name === 'GetCommand') {
        const input = (command as unknown as { input?: { Key?: { pk?: string } } }).input;
        const key = input?.Key?.pk ?? '';
        return { Item: storedImports.get(key) };
      }

      if (name === 'ScanCommand') {
        return { Items: Array.from(storedImports.values()) };
      }

      if (name === 'QueryCommand') {
        return { Items: chunkResults };
      }

      return {};
    });

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
    expect(await store.updateImport('missing', { status: 'FAILED' })).toBeUndefined();

    const updatedImport = await store.updateImport('import-1', { status: 'PROCESSING', processedChunks: 1 });
    expect(updatedImport).toMatchObject({ status: 'PROCESSING', processedChunks: 1 });

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
    expect(await store.getImport('import-2')).toMatchObject({ id: 'import-2', filename: 'compact.csv' });

    await store.saveChunkResult({
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
  });

  it('covers DynamoDB defaults and empty responses', async () => {
    const send = jest.fn(async (command: unknown) => {
      const name = (command as { constructor?: { name?: string } }).constructor?.name;

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
        return { Items: [] };
      }

      if (name === 'QueryCommand') {
        return {
          Items: [
            {
              pk: 'IMPORT#import-9',
              sk: 'CHUNK#000001',
            },
          ],
        };
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
    expect(await store.listChunkResults('import-9')).toEqual([
      expect.objectContaining({
        importId: 'import-9',
        chunkNumber: 0,
        workerId: '',
        requestId: '',
        errors: [],
        durationMs: 0,
      }),
    ]);
  });
});