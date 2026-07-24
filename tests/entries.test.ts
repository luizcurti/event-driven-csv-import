import { describe, expect, it, jest } from '@jest/globals';
import { InvokeCommand } from '@aws-sdk/client-lambda';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { createDependencies } from '../shared/dependencies.js';
import type { ChunkMessage, ImportRecord } from '../shared/types.js';
import { createUploadEntryHandler } from '../lambdas/upload/entry.js';
import { createStatusEntryHandler } from '../lambdas/status/entry.js';
import { createSplitEntryHandler } from '../lambdas/split/entry.js';
import { createWorkerEntryHandler } from '../lambdas/worker/entry.js';
import { createAggregatorEntryHandler } from '../lambdas/aggregator/entry.js';
import '../lambdas/upload/entry.js';
import '../lambdas/status/entry.js';
import '../lambdas/split/entry.js';
import '../lambdas/worker/entry.js';
import '../lambdas/aggregator/entry.js';

const baseImport = (overrides: Partial<ImportRecord> = {}): ImportRecord => ({
  id: 'import-1',
  correlationId: 'correlation-1',
  filename: 'file.csv',
  bucket: 'bucket-a',
  key: 'incoming/import-1/file.csv',
  status: 'UPLOADED',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  totalChunks: 0,
  processedChunks: 0,
  totalRecords: 0,
  processedRecords: 0,
  failedRecords: 0,
  successRecords: 0,
  chunkSize: 5000,
  ...overrides,
});

describe('lambda entry adapters', () => {
  it('adapts an API Gateway REST event for upload', async () => {
    const dependencies = createDependencies();
    const handler = createUploadEntryHandler(dependencies);

    const response = await handler({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fileName: 'customers.csv',
        contentType: 'text/csv',
        body: 'customerId,name,email,cpf,age\n1,Alice,alice@example.com,52998224725,30',
      }),
      isBase64Encoded: false,
    } as never);

    expect(response.statusCode).toBe(201);
  });

  it('adapts an API Gateway REST event for status with and without a path parameter', async () => {
    const dependencies = createDependencies();
    await dependencies.store.saveImport(baseImport());
    const handler = createStatusEntryHandler(dependencies);

    const single = await handler({ pathParameters: { id: 'import-1' } } as never);
    expect(JSON.parse(single.body ?? '{}')).toMatchObject({ id: 'import-1' });

    const list = await handler({ pathParameters: null } as never);
    expect(JSON.parse(list.body ?? '{}')).toMatchObject({ items: [expect.objectContaining({ id: 'import-1' })] });
  });

  it('converts a thrown AppError into a proper HTTP error response instead of a raw Lambda error', async () => {
    const dependencies = createDependencies();
    const handler = createUploadEntryHandler(dependencies);

    const response = await handler({
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
      isBase64Encoded: false,
    } as never);

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body ?? '{}')).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('converts a thrown AppError from the status handler into a 404 response', async () => {
    const dependencies = createDependencies();
    const handler = createStatusEntryHandler(dependencies);

    const response = await handler({ pathParameters: { id: 'missing-import' } } as never);

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body ?? '{}')).toMatchObject({ code: 'IMPORT_NOT_FOUND' });
  });

  it('converts an unexpected non-AppError thrown by the upload handler into a generic 500 response', async () => {
    const dependencies = createDependencies();
    const brokenStore = {
      ...dependencies.store,
      saveImport: async () => {
        throw new Error('unexpected failure');
      },
    };
    const handler = createUploadEntryHandler({ ...dependencies, store: brokenStore } as never);

    const response = await handler({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fileName: 'customers.csv',
        contentType: 'text/csv',
        body: 'customerId,name,email,cpf,age\n1,Alice,alice@example.com,52998224725,30',
      }),
      isBase64Encoded: false,
    } as never);

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body ?? '{}')).toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('splits a CSV and enqueues one SQS message per chunk, resolving importId from event.importId', async () => {
    const dependencies = createDependencies();
    const csv = ['customerId,name,email,cpf,age', '1,Alice,alice@example.com,52998224725,30', '2,Bob,bob@example.com,12345678909,40'].join(
      '\n',
    );
    await dependencies.storage.putObject({
      bucket: 'bucket-a',
      key: 'incoming/import-1/file.csv',
      body: csv,
      contentType: 'text/csv',
    });
    await dependencies.store.saveImport(baseImport({ chunkSize: 1 }));

    const send = jest.fn(async () => ({}));
    const handler = createSplitEntryHandler(dependencies, { send } as never, 'https://queue.example/processing');

    const result = await handler({ importId: 'import-1' });

    expect(result.totalChunks).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith(expect.any(SendMessageCommand));
  });

  it('resolves importId from the S3 ObjectCreated detail key and rejects when the key is unusable', async () => {
    const dependencies = createDependencies();
    await dependencies.storage.putObject({
      bucket: 'bucket-a',
      key: 'incoming/import-1/file.csv',
      body: 'customerId,name,email,cpf,age\n1,Alice,alice@example.com,52998224725,30',
      contentType: 'text/csv',
    });
    await dependencies.store.saveImport(baseImport());

    const send = jest.fn(async () => ({}));
    const handler = createSplitEntryHandler(dependencies, { send } as never, 'https://queue.example/processing');

    const result = await handler({ detail: { object: { key: 'incoming/import-1/file.csv' } } });
    expect(result.importId).toBe('import-1');

    await expect(
      createSplitEntryHandler(dependencies, { send } as never, 'https://queue.example/processing')({
        detail: { object: { key: '' } },
      }),
    ).rejects.toThrow('Unable to extract importId');

    await expect(
      createSplitEntryHandler(dependencies, { send } as never, 'https://queue.example/processing')({}),
    ).rejects.toThrow('Unable to extract importId');
  });

  it('processes SQS chunk messages and reports batch item failures', async () => {
    const dependencies = createDependencies();
    await dependencies.storage.putObject({
      bucket: 'bucket-a',
      key: 'processing/import-1/chunk-0001.csv',
      body: 'customerId,name,email,cpf,age\n1,Alice,alice@example.com,52998224725,30',
      contentType: 'text/csv',
    });

    const message: ChunkMessage = {
      importId: 'import-1',
      chunkNumber: 1,
      bucket: 'bucket-a',
      key: 'processing/import-1/chunk-0001.csv',
      totalChunks: 1,
      correlationId: 'correlation-1',
    };

    const send = jest.fn(async () => ({}));
    const handler = createWorkerEntryHandler(dependencies, { send } as never, '');

    const result = await handler({
      Records: [
        { messageId: 'msg-1', body: JSON.stringify(message) } as never,
        { messageId: 'msg-2', body: 'not-json' } as never,
      ],
    });

    expect(send).not.toHaveBeenCalled();
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-2' }]);
  });

  it('invokes the aggregator once every chunk of an import has been processed', async () => {
    const dependencies = createDependencies();
    await dependencies.storage.putObject({
      bucket: 'bucket-a',
      key: 'processing/import-1/chunk-0001.csv',
      body: 'customerId,name,email,cpf,age\n1,Alice,alice@example.com,52998224725,30',
      contentType: 'text/csv',
    });
    await dependencies.store.saveImport(baseImport({ totalChunks: 1 }));

    const message: ChunkMessage = {
      importId: 'import-1',
      chunkNumber: 1,
      bucket: 'bucket-a',
      key: 'processing/import-1/chunk-0001.csv',
      totalChunks: 1,
      correlationId: 'correlation-1',
    };

    const send = jest.fn(async () => ({}));
    const handler = createWorkerEntryHandler(dependencies, { send } as never, 'aggregator-function');

    await handler({ Records: [{ messageId: 'msg-1', body: JSON.stringify(message) } as never] });

    expect(send).toHaveBeenCalledWith(expect.any(InvokeCommand));
  });

  it('does not invoke the aggregator while chunks are still pending', async () => {
    const dependencies = createDependencies();
    await dependencies.storage.putObject({
      bucket: 'bucket-a',
      key: 'processing/import-1/chunk-0001.csv',
      body: 'customerId,name,email,cpf,age\n1,Alice,alice@example.com,52998224725,30',
      contentType: 'text/csv',
    });
    await dependencies.store.saveImport(baseImport({ totalChunks: 2 }));

    const message: ChunkMessage = {
      importId: 'import-1',
      chunkNumber: 1,
      bucket: 'bucket-a',
      key: 'processing/import-1/chunk-0001.csv',
      totalChunks: 2,
      correlationId: 'correlation-1',
    };

    const send = jest.fn(async () => ({}));
    const handler = createWorkerEntryHandler(dependencies, { send } as never, 'aggregator-function');

    await handler({ Records: [{ messageId: 'msg-1', body: JSON.stringify(message) } as never] });

    expect(send).not.toHaveBeenCalled();
  });

  it('aggregates an import through the entry adapter', async () => {
    const dependencies = createDependencies();
    await dependencies.store.saveImport(baseImport());
    const handler = createAggregatorEntryHandler(dependencies);

    const result = await handler({ importId: 'import-1' });

    expect(result.importId).toBe('import-1');
  });
});
