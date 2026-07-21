import { describe, expect, it } from '@jest/globals';
import { createDependencies } from '../shared/dependencies.js';
import { InMemoryImportStore } from '../shared/repository.js';
import { InMemoryObjectStorage } from '../shared/object-storage.js';
import { createUploadHandler } from '../lambdas/upload/handler.js';
import { createSplitHandler } from '../lambdas/split/handler.js';
import { createWorkerHandler } from '../lambdas/worker/handler.js';
import { createAggregatorHandler } from '../lambdas/aggregator/handler.js';
import { createStatusHandler } from '../lambdas/status/handler.js';
import type { AppDependencies } from '../shared/dependencies.js';
import type { ImportRecord } from '../shared/types.js';

const createTestDependencies = (overrides: Partial<AppDependencies['config']> = {}): AppDependencies =>
  createDependencies({
    config: {
      environment: 'test',
      importsBucket: 'imports-bucket',
      chunkSize: 2,
      maxFileSizeBytes: 1024 * 1024,
      allowedMimeTypes: ['text/csv'],
      workerConcurrency: 2,
      ...overrides,
    },
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      child: () => ({ info: () => undefined, warn: () => undefined, error: () => undefined, child: () => undefined } as never),
    } as never,
    store: new InMemoryImportStore(),
    storage: new InMemoryObjectStorage(),
  });

const event = (body: string, headers: Record<string, string>, isBase64Encoded = false) => ({
  version: '2.0',
  routeKey: 'POST /imports',
  rawPath: '/imports',
  rawQueryString: '',
  headers,
  requestContext: {} as never,
  isBase64Encoded,
  body,
});

const seedImport = async (dependencies: AppDependencies, overrides: Partial<ImportRecord> = {}): Promise<ImportRecord> => {
  const record: ImportRecord = {
    id: 'import-1',
    correlationId: 'correlation-1',
    filename: 'customers.csv',
    bucket: dependencies.config.importsBucket,
    key: 'incoming/import-1/customers.csv',
    status: 'UPLOADED',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    totalChunks: 0,
    processedChunks: 0,
    totalRecords: 0,
    processedRecords: 0,
    failedRecords: 0,
    successRecords: 0,
    chunkSize: 1,
    ...overrides,
  };

  await dependencies.store.saveImport(record);
  return record;
};

describe('handler coverage', () => {
  it('supports upload success and validation failures', async () => {
    const dependencies = createTestDependencies();
    const handler = createUploadHandler(dependencies);

    const jsonResponse = await handler(
      event(
        JSON.stringify({
          fileName: 'customers.csv',
          contentType: 'text/csv',
          body: 'customerId,name,email,cpf,age\n1,Alice,alice@example.com,52998224725,30',
        }),
        { 'content-type': 'application/json', 'x-correlation-id': 'correlation-1' },
      ),
    );

    expect(jsonResponse.statusCode).toBe(201);
    expect(await dependencies.store.listImports()).toHaveLength(1);

    const base64Response = await handler(
      event(
        Buffer.from(
          JSON.stringify({
            fileName: 'customers.csv',
            contentType: 'text/csv',
            body: 'customerId,name,email,cpf,age\n1,Alice,alice@example.com,52998224725,30',
          }),
        ).toString('base64'),
        {},
        true,
      ),
    );

    expect(base64Response.statusCode).toBe(201);

    const multipartResponse = await handler(
      event(
        [
          '--boundary',
          'Content-Disposition: form-data; name="file"; filename="customers.csv"',
          'Content-Type: text/csv',
          '',
          'customerId,name,email,cpf,age',
          '1,Alice,alice@example.com,52998224725,30',
          '--boundary--',
        ].join('\r\n'),
        { 'content-type': 'multipart/form-data; boundary=boundary' },
      ),
    );

    expect(multipartResponse.statusCode).toBe(201);

    await expect(handler(event('not-json', { 'content-type': 'application/json' }))).rejects.toThrow(
      'Upload payload must be multipart/form-data or a valid JSON envelope.',
    );
    await expect(
      handler(
        event(
          JSON.stringify({
            fileName: 'customers.csv',
            contentType: 'text/csv',
          }),
          { 'content-type': 'application/json' },
        ),
      ),
    ).rejects.toThrow('Upload payload must be multipart/form-data or a valid JSON envelope.');
    await expect(handler(event('', { 'content-type': 'multipart/form-data' }))).rejects.toThrow('Multipart boundary is missing.');
    await expect(
      handler(event(undefined as unknown as string, { 'content-type': 'application/json' })),
    ).rejects.toThrow('Upload payload must be multipart/form-data or a valid JSON envelope.');
    await expect(
      handler(event(undefined as unknown as string, { 'content-type': 'application/json' }, true)),
    ).rejects.toThrow('Upload payload must be multipart/form-data or a valid JSON envelope.');
    await expect(
      handler(
        event(
          ['--boundary', 'Content-Disposition: form-data; name="other"', '', 'payload', '--boundary--'].join('\r\n'),
          { 'content-type': 'multipart/form-data; boundary=boundary' },
        ),
      ),
    ).rejects.toThrow('File field not found in multipart payload.');

    await expect(
      handler(
        event(
          ['--boundary', 'Content-Disposition: form-data; name="file"; filename="customers.csv"', 'Content-Type: text/csv', '--boundary--'].join('\r\n'),
          { 'content-type': 'multipart/form-data; boundary=boundary' },
        ),
      ),
    ).rejects.toThrow('File field not found in multipart payload.');

    const defaultMultipartDependencies = createTestDependencies();
    const defaultMultipartHandler = createUploadHandler(defaultMultipartDependencies);
    const defaultMultipartResponse = await defaultMultipartHandler(
      event(
        [
          '--boundary',
          'Content-Disposition: form-data; name="file"',
          '',
          'customerId,name,email,cpf,age',
          '1,Alice,alice@example.com,52998224725,30',
          '--boundary--',
        ].join('\r\n'),
        { 'content-type': 'multipart/form-data; boundary=boundary' },
      ),
    );

    expect(defaultMultipartResponse.statusCode).toBe(201);
    expect((await defaultMultipartDependencies.store.listImports())[0]).toMatchObject({ filename: 'import.csv' });
  });

  it('splits imports and handles missing inputs', async () => {
    const dependencies = createTestDependencies({ chunkSize: 1 });
    const importRecord = await seedImport(dependencies);
    await dependencies.storage.putObject({
      bucket: dependencies.config.importsBucket,
      key: importRecord.key,
      body: 'customerId,name,email,cpf,age\n1,Alice,alice@example.com,52998224725,30\n2,Bob,bob@example.com,12345678909,40',
      contentType: 'text/csv',
    });

    const splitHandler = createSplitHandler(dependencies);
    const result = await splitHandler(importRecord.id);
    expect(result.totalChunks).toBe(2);
    expect(await dependencies.store.getImport(importRecord.id)).toMatchObject({ status: 'QUEUED', totalChunks: 2, totalRecords: 2 });

    const fallbackDependencies = createTestDependencies({ chunkSize: 3 });
    const fallbackImport = await seedImport(fallbackDependencies, { chunkSize: undefined as unknown as number });
    await fallbackDependencies.storage.putObject({
      bucket: fallbackDependencies.config.importsBucket,
      key: fallbackImport.key,
      body: 'customerId,name,email,cpf,age\n1,Alice,alice@example.com,52998224725,30\n2,Bob,bob@example.com,12345678909,40\n3,Carol,carol@example.com,39053344705,22',
      contentType: 'text/csv',
    });

    expect((await createSplitHandler(fallbackDependencies)(fallbackImport.id)).totalChunks).toBe(1);

    const emptyDependencies = createTestDependencies();
    const emptyImport = await seedImport(emptyDependencies, { chunkSize: 5 });
    await emptyDependencies.storage.putObject({
      bucket: emptyDependencies.config.importsBucket,
      key: emptyImport.key,
      body: 'customerId,name,email,cpf,age',
      contentType: 'text/csv',
    });

    expect((await createSplitHandler(emptyDependencies)(emptyImport.id)).totalChunks).toBe(0);
    await expect(createSplitHandler(createTestDependencies())('missing')).rejects.toThrow('Import not found.');
    const missingObjectDependencies = createTestDependencies();
    await seedImport(missingObjectDependencies);
    await expect(createSplitHandler(missingObjectDependencies)('import-1')).rejects.toThrow('Source CSV not found in storage.');
  });

  it('processes worker chunks across all result branches', async () => {
    const completedDependencies = createTestDependencies();
    const completedImport = await seedImport(completedDependencies, { status: 'QUEUED' });
    await completedDependencies.storage.putObject({
      bucket: completedDependencies.config.importsBucket,
      key: 'processing/import-1/chunk-0001.csv',
      body: 'customerId,name,email,cpf,age\n1,Alice,alice@example.com,52998224725,30',
      contentType: 'text/csv',
    });

    expect(
      (await createWorkerHandler(completedDependencies)({
        importId: completedImport.id,
        chunkNumber: 1,
        bucket: completedDependencies.config.importsBucket,
        key: 'processing/import-1/chunk-0001.csv',
        totalChunks: 1,
        correlationId: completedImport.correlationId,
      })).result.status,
    ).toBe('COMPLETED');

    const partialDependencies = createTestDependencies();
    const partialImport = await seedImport(partialDependencies, { status: 'QUEUED' });
    await partialDependencies.storage.putObject({
      bucket: partialDependencies.config.importsBucket,
      key: 'processing/import-1/chunk-0002.csv',
      body: 'customerId,name,email,cpf,age\n1,Alice,alice@example.com,52998224725,30\n2,Bob,bad-email,11111111111,-1',
      contentType: 'text/csv',
    });

    expect(
      (await createWorkerHandler(partialDependencies)({
        importId: partialImport.id,
        chunkNumber: 2,
        bucket: partialDependencies.config.importsBucket,
        key: 'processing/import-1/chunk-0002.csv',
        totalChunks: 1,
        correlationId: partialImport.correlationId,
      })).result.status,
    ).toBe('PARTIAL_SUCCESS');

    const failedDependencies = createTestDependencies();
    const failedImport = await seedImport(failedDependencies, { status: 'QUEUED' });
    await failedDependencies.storage.putObject({
      bucket: failedDependencies.config.importsBucket,
      key: 'processing/import-1/chunk-0003.csv',
      body: 'customerId,name,email,cpf,age\n2,Bob,bad-email,11111111111,-1',
      contentType: 'text/csv',
    });

    expect(
      (await createWorkerHandler(failedDependencies)({
        importId: failedImport.id,
        chunkNumber: 3,
        bucket: failedDependencies.config.importsBucket,
        key: 'processing/import-1/chunk-0003.csv',
        totalChunks: 1,
        correlationId: failedImport.correlationId,
      })).result.status,
    ).toBe('FAILED');

    await expect(
      createWorkerHandler(createTestDependencies())({
        importId: 'missing',
        chunkNumber: 1,
        bucket: 'bucket',
        key: 'missing.csv',
        totalChunks: 1,
        correlationId: 'correlation-1',
      }),
    ).rejects.toThrow('Chunk object not found.');
  });

  it('aggregates results and reports statuses', async () => {
    const completedDependencies = createTestDependencies();
    const completedImport = await seedImport(completedDependencies, { totalChunks: 1 });
    await completedDependencies.store.saveChunkResult({
      importId: completedImport.id,
      chunkNumber: 1,
      workerId: 'worker-1',
      requestId: 'request-1',
      status: 'COMPLETED',
      recordsProcessed: 1,
      successRecords: 1,
      failedRecords: 0,
      errors: [],
      durationMs: 5,
      correlationId: completedImport.correlationId,
    });
    expect((await createAggregatorHandler(completedDependencies)(completedImport.id)).status).toBe('COMPLETED');

    const partialDependencies = createTestDependencies();
    const partialImport = await seedImport(partialDependencies, { totalChunks: 1 });
    await partialDependencies.store.saveChunkResult({
      importId: partialImport.id,
      chunkNumber: 1,
      workerId: 'worker-1',
      requestId: 'request-1',
      status: 'PARTIAL_SUCCESS',
      recordsProcessed: 2,
      successRecords: 1,
      failedRecords: 1,
      errors: ['2'],
      durationMs: 5,
      correlationId: partialImport.correlationId,
    });
    expect((await createAggregatorHandler(partialDependencies)(partialImport.id)).status).toBe('PARTIAL_SUCCESS');

    const failedDependencies = createTestDependencies();
    const failedImport = await seedImport(failedDependencies, { totalChunks: 1 });
    await failedDependencies.store.saveChunkResult({
      importId: failedImport.id,
      chunkNumber: 1,
      workerId: 'worker-1',
      requestId: 'request-1',
      status: 'FAILED',
      recordsProcessed: 1,
      successRecords: 0,
      failedRecords: 1,
      errors: ['1'],
      durationMs: 5,
      correlationId: failedImport.correlationId,
    });
    expect((await createAggregatorHandler(failedDependencies)(failedImport.id)).status).toBe('FAILED');
    await expect(createAggregatorHandler(createTestDependencies())('missing')).rejects.toThrow('Import not found.');

    const statusDependencies = createTestDependencies();
    const statusImport = await seedImport(statusDependencies);
    const statusHandler = createStatusHandler(statusDependencies);
    expect(JSON.parse((await statusHandler()).body ?? '{}')).toMatchObject({ items: [expect.objectContaining({ id: statusImport.id })] });
    expect(JSON.parse((await statusHandler(statusImport.id)).body ?? '{}')).toMatchObject({ id: statusImport.id, status: 'UPLOADED' });
    await expect(statusHandler('missing')).rejects.toThrow('Import not found.');
  });
});