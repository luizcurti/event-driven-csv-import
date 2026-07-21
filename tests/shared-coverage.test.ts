import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { CreateBucketCommand, HeadBucketCommand, type S3Client as AwsS3Client } from '@aws-sdk/client-s3';
import {
  CreateEventBusCommand,
  DescribeEventBusCommand,
  type EventBridgeClient,
} from '@aws-sdk/client-eventbridge';
import {
  CreateStateMachineCommand,
  ListStateMachinesCommand,
  type SFNClient,
} from '@aws-sdk/client-sfn';
import { createAwsClients } from '../shared/aws-clients.js';
import { loadConfig } from '../shared/config.js';
import { createDependencies, createAwsDependencies } from '../shared/dependencies.js';
import {
  AppError,
  ChunkProcessingException,
  ImportNotFoundException,
  InvalidFileException,
  StorageException,
  ValidationException,
} from '../shared/errors.js';
import { createEvent } from '../shared/events.js';
import { createId } from '../shared/id.js';
import { Logger, createLogger } from '../shared/logger.js';
import { InMemoryObjectStorage } from '../shared/object-storage.js';
import { InMemoryImportStore } from '../shared/repository.js';
import { S3ObjectStorage, createBucketObjectKey } from '../shared/s3-object-storage.js';
import { parseCsvText, splitCsvIntoChunks, mapCsvRowsToCustomerRecords } from '../shared/csv.js';
import { validateCustomerRecord, validateUploadFile } from '../shared/validation.js';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('shared coverage', () => {
  it('loads config with defaults and parsed overrides', () => {
    const defaultConfig = loadConfig({});
    const config = loadConfig({
      NODE_ENV: 'test',
      IMPORTS_BUCKET: 'imports-bucket',
      CHUNK_SIZE: '1024',
      MAX_FILE_SIZE_BYTES: '4096',
      ALLOWED_MIME_TYPES: 'text/csv, application/csv',
      WORKER_CONCURRENCY: '8',
    });

    expect(config).toEqual({
      environment: 'test',
      importsBucket: 'imports-bucket',
      chunkSize: 1024,
      maxFileSizeBytes: 4096,
      allowedMimeTypes: ['text/csv', 'application/csv'],
      workerConcurrency: 8,
    });

    expect(defaultConfig).toEqual({
      environment: 'development',
      importsBucket: 'event-driven-data-ingestion',
      chunkSize: 5000,
      maxFileSizeBytes: 50 * 1024 * 1024,
      allowedMimeTypes: ['text/csv', 'application/csv', 'text/plain'],
      workerConcurrency: 10,
    });
  });

  it('creates ids, errors, and event envelopes', () => {
    const id = createId();
    const event = createEvent('FileUploaded', 'correlation-1', 'import-1', { ok: true });
    const customSourceEvent = createEvent('ChunkCompleted', 'correlation-2', 'import-2', { chunkNumber: 1 }, 'custom');
    const defaultError = new AppError('generic', 'GENERIC');

    expect(id).toMatch(/^[0-9a-f-]{36}$/iu);
    expect(event).toMatchObject({
      version: '1.0',
      source: 'event-driven-data-ingestion',
      detailType: 'FileUploaded',
      correlationId: 'correlation-1',
      importId: 'import-1',
      detail: { ok: true },
    });
    expect(customSourceEvent.source).toBe('custom');

    expect([
      new AppError('generic', 'GENERIC', 418),
      new InvalidFileException(),
      new ValidationException(),
      new ChunkProcessingException(),
      new ImportNotFoundException(),
      new StorageException(),
    ]).toEqual([
      expect.objectContaining({ name: 'AppError', code: 'GENERIC', statusCode: 418 }),
      expect.objectContaining({ name: 'InvalidFileException', code: 'INVALID_FILE', statusCode: 400 }),
      expect.objectContaining({ name: 'ValidationException', code: 'VALIDATION_ERROR', statusCode: 400 }),
      expect.objectContaining({ name: 'ChunkProcessingException', code: 'CHUNK_PROCESSING_ERROR', statusCode: 500 }),
      expect.objectContaining({ name: 'ImportNotFoundException', code: 'IMPORT_NOT_FOUND', statusCode: 404 }),
      expect.objectContaining({ name: 'StorageException', code: 'STORAGE_ERROR', statusCode: 500 }),
    ]);
    expect(defaultError).toMatchObject({ code: 'GENERIC', statusCode: 500 });
  });

  it('logs structured payloads and merges child context', () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const logger = createLogger('app', { service: 'ingestion' });
    const plainLogger = createLogger('plain');
    const directLogger = new Logger('direct');
    const child = logger.child({ requestId: 'request-1' });

    child.info('started', { importId: 'import-1' });
    plainLogger.info('plain');
    directLogger.info('direct');
    logger.warn('slow', { workerId: 'worker-1' });
    logger.warn('slow-without-context');
    logger.error('failed', { status: 'FAILED' });
    logger.error('failed-without-context');

    expect(JSON.parse(infoSpy.mock.calls[0]?.[0] as string)).toMatchObject({
      level: 'info',
      scope: 'app',
      service: 'ingestion',
      requestId: 'request-1',
      importId: 'import-1',
      message: 'started',
    });
    expect(JSON.parse(infoSpy.mock.calls[1]?.[0] as string)).toMatchObject({
      level: 'info',
      scope: 'plain',
      message: 'plain',
    });
    expect(JSON.parse(infoSpy.mock.calls[2]?.[0] as string)).toMatchObject({
      level: 'info',
      scope: 'direct',
      message: 'direct',
    });
    expect(JSON.parse(warnSpy.mock.calls[0]?.[0] as string)).toMatchObject({
      level: 'warn',
      scope: 'app',
      service: 'ingestion',
      workerId: 'worker-1',
      message: 'slow',
    });
    expect(JSON.parse(warnSpy.mock.calls[1]?.[0] as string)).toMatchObject({
      level: 'warn',
      scope: 'app',
      service: 'ingestion',
      message: 'slow-without-context',
    });
    expect(JSON.parse(errorSpy.mock.calls[0]?.[0] as string)).toMatchObject({
      level: 'error',
      scope: 'app',
      service: 'ingestion',
      status: 'FAILED',
      message: 'failed',
    });
    expect(JSON.parse(errorSpy.mock.calls[1]?.[0] as string)).toMatchObject({
      level: 'error',
      scope: 'app',
      service: 'ingestion',
      message: 'failed-without-context',
    });
  });

  it('handles csv parsing, chunking, mapping, and validation', () => {
    const csv = 'customerId,name,email,cpf,age\r\n1,"Alice, A.",alice@example.com,52998224725,30\r\n2,Bob,bob@example.com,12345678909,40';
    const quotedCsv = 'customerId,name\n1,"Alice ""Ace"" Smith"';

    expect(parseCsvText('')).toEqual([]);
    expect(parseCsvText('customerId,name')).toEqual([]);
    expect(parseCsvText(csv)).toEqual([
      {
        customerId: '1',
        name: 'Alice, A.',
        email: 'alice@example.com',
        cpf: '52998224725',
        age: '30',
      },
      {
        customerId: '2',
        name: 'Bob',
        email: 'bob@example.com',
        cpf: '12345678909',
        age: '40',
      },
    ]);
    expect(parseCsvText(quotedCsv)).toEqual([{ customerId: '1', name: 'Alice "Ace" Smith' }]);

    expect(splitCsvIntoChunks('', 10)).toEqual([]);
    expect(splitCsvIntoChunks('customerId,name', 10)).toEqual([]);
    expect(splitCsvIntoChunks(csv, 1)).toHaveLength(2);

    expect(mapCsvRowsToCustomerRecords([{ customer_id: '1', name: 'Alice', email: 'alice@example.com', cpf: '52998224725', age: '30' }])).toEqual([
      expect.objectContaining({ customerId: '1', name: 'Alice', status: 'VALID' }),
    ]);

    expect(
      validateCustomerRecord({
        customerId: ' ',
        name: '',
        email: 'bad',
        cpf: '11111111111',
        age: -1,
        status: 'VALID',
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'customerId' }),
        expect.objectContaining({ field: 'name' }),
        expect.objectContaining({ field: 'email' }),
        expect.objectContaining({ field: 'cpf' }),
        expect.objectContaining({ field: 'age' }),
      ]),
    );
    expect(
      validateCustomerRecord({
        customerId: '',
        name: '',
        email: '',
        cpf: '',
        age: Number.NaN,
        status: 'VALID',
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'customerId' }),
        expect.objectContaining({ field: 'name' }),
        expect.objectContaining({ field: 'email' }),
        expect.objectContaining({ field: 'cpf' }),
        expect.objectContaining({ field: 'age' }),
      ]),
    );
    expect(
      validateCustomerRecord({
        customerId: '1',
        name: 'Alice',
        email: 'alice@example.com',
        cpf: '1234567890',
        age: 30,
        status: 'VALID',
      }),
    ).toEqual([
      expect.objectContaining({ field: 'cpf' }),
    ]);

    expect(() => validateUploadFile('customers.csv', 'text/csv', 10, ['text/csv'], 100)).not.toThrow();
    expect(() => validateUploadFile('customers.txt', 'text/csv', 10, ['text/csv'], 100)).toThrow('Only CSV files are accepted.');
    expect(() => validateUploadFile('customers.csv', 'application/json', 10, ['text/csv'], 100)).toThrow('Unsupported file content type.');
    expect(() => validateUploadFile('customers.csv', 'text/csv', 101, ['text/csv'], 100)).toThrow('File size exceeds the configured limit.');
  });

  it('keeps objects and records in memory', async () => {
    const storage = new InMemoryObjectStorage();
    await storage.putObject({
      bucket: 'bucket-a',
      key: 'incoming/file.csv',
      body: 'hello',
      contentType: 'text/csv',
      metadata: { importId: 'import-1' },
    });

    expect(await storage.getObject('bucket-a', 'incoming/file.csv')).toMatchObject({
      body: 'hello',
      metadata: { importId: 'import-1' },
    });
    await storage.moveObject('bucket-a', 'incoming/file.csv', 'bucket-a', 'processed/file.csv');
    expect(await storage.getObject('bucket-a', 'incoming/file.csv')).toBeUndefined();
    expect(await storage.getObject('bucket-a', 'processed/file.csv')).toMatchObject({
      body: 'hello',
      metadata: { importId: 'import-1' },
    });
    expect(await storage.listObjects('bucket-a', 'processed/')).toHaveLength(1);
    expect(await storage.listObjects('bucket-a', undefined)).toHaveLength(1);
    await storage.putObject({
      bucket: 'bucket-a',
      key: 'incoming/plain.csv',
      body: 'plain',
      contentType: 'text/csv',
    });
    await storage.moveObject('bucket-a', 'incoming/plain.csv', 'bucket-a', 'processed/plain.csv');
    expect(await storage.getObject('bucket-a', 'processed/plain.csv')).toMatchObject({
      body: 'plain',
    });
    await storage.moveObject('bucket-a', 'missing.csv', 'bucket-a', 'still-missing.csv');

    const store = new InMemoryImportStore();
    const now = new Date().toISOString();
    const record = {
      id: 'import-1',
      correlationId: 'correlation-1',
      filename: 'customers.csv',
      bucket: 'bucket-a',
      key: 'incoming/import-1/customers.csv',
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
    } as const;

    await store.saveImport(record);
    expect(await store.getImport('import-1')).toEqual(record);
    expect(await store.listImports()).toEqual([record]);
    expect(await store.updateImport('missing', { status: 'FAILED' })).toBeUndefined();
    expect(await store.listChunkResults('missing')).toEqual([]);
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

  it('covers aws client and adapter branches', async () => {
    const baseClients = createAwsClients({ region: 'us-east-1' });
    const localClients = createAwsClients({ region: 'us-east-1', endpoint: 'http://localhost:4566' });

    expect(baseClients.s3).toBeInstanceOf(S3Client);
    expect(localClients.s3).toBeInstanceOf(S3Client);
    expect(localClients.dynamoDb).toBeDefined();
    expect(localClients.eventBridge).toBeDefined();
    expect(localClients.stepFunctions).toBeDefined();

    expect(createDependencies().store).toBeInstanceOf(InMemoryImportStore);
    expect(createDependencies().storage).toBeInstanceOf(InMemoryObjectStorage);

    const defaultAwsDependencies = createAwsDependencies();
    expect(defaultAwsDependencies.logger).toBeDefined();

    const endpointFallbackDependencies = createAwsDependencies(
      {},
      {
        NODE_ENV: 'production',
        IMPORTS_BUCKET: 'imports-bucket',
        AWS_ENDPOINT_URL: 'http://localhost:4566',
        AWS_REGION: 'us-east-1',
      },
    );
    expect(endpointFallbackDependencies.logger).toBeDefined();

    const awsDependencies = createAwsDependencies(
      {},
      {
        NODE_ENV: 'localstack',
        IMPORTS_BUCKET: 'imports-bucket',
        AWS_REGION: 'us-east-1',
      },
    );

    const customStore = new InMemoryImportStore();
    const customStorage = new InMemoryObjectStorage();
    const customLogger = createLogger('custom');
    const overriddenAwsDependencies = createAwsDependencies(
      {
        config: awsDependencies.config,
        logger: customLogger,
        store: customStore,
        storage: customStorage,
      },
      {
        NODE_ENV: 'production',
        IMPORTS_BUCKET: 'imports-bucket',
        IMPORTS_TABLE_NAME: 'imports-table',
        AWS_REGION: 'us-east-1',
      },
    );

    expect(overriddenAwsDependencies.logger).toBe(customLogger);
    expect(overriddenAwsDependencies.store).toBe(customStore);
    expect(overriddenAwsDependencies.storage).toBe(customStorage);

    const moveSend = jest.fn(async (command: unknown) => {
      const name = (command as { constructor?: { name?: string } }).constructor?.name;

      if (name === 'GetObjectCommand') {
        return { Body: 'move-body', ContentType: 'text/csv', Metadata: { importId: 'import-1' } };
      }

      if (name === 'PutObjectCommand') {
        return {};
      }

      return {};
    });

    const moveStorage = new S3ObjectStorage({ send: moveSend } as unknown as AwsS3Client, 'bucket-a');
    await moveStorage.moveObject('bucket-a', 'source.csv', 'bucket-b', 'target.csv');
    expect(moveSend).toHaveBeenCalledWith(expect.any(GetObjectCommand));
    expect(moveSend).toHaveBeenCalledWith(expect.any(PutObjectCommand));

    const s3Send = jest.fn(async (command: unknown) => {
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

    const storage = new S3ObjectStorage({ send: s3Send } as unknown as AwsS3Client, 'bucket-a');
    await storage.putObject({ bucket: 'bucket-a', key: 'incoming/file.csv', body: 'csv', contentType: 'text/csv', metadata: { importId: 'import-1' } });
    expect(await storage.getObject('bucket-a', 'string.csv')).toMatchObject({ body: 'string-body', metadata: { importId: 'import-1' } });
    expect(await storage.getObject('bucket-a', 'bytes.csv')).toMatchObject({ body: 'bytes-body' });
    expect(await storage.getObject('bucket-a', 'stream.csv')).toMatchObject({ body: 'stream-body', contentType: 'application/octet-stream' });
    expect(await storage.getObject('bucket-a', 'empty.csv')).toBeUndefined();
    expect(await storage.getObject('bucket-a', 'invalid.csv')).toBeUndefined();
    await storage.moveObject('bucket-a', 'string.csv', 'bucket-a', 'moved.csv');
    expect(await storage.listObjects('bucket-a', 'processed/')).toEqual([expect.objectContaining({ key: 'processed/file.csv' })]);
    expect(await storage.listObjects('bucket-a')).toEqual([]);
    expect(await storage.listObjects('bucket-a', 'missing/')).toEqual([]);
    expect(createBucketObjectKey('bucket-a', 'key.csv')).toBe('bucket-a/key.csv');

    const plainAwsDependencies = createAwsDependencies(
      {},
      {
        NODE_ENV: 'production',
        IMPORTS_BUCKET: 'imports-bucket',
        IMPORTS_TABLE_NAME: 'imports-table',
        AWS_REGION: 'us-east-1',
      },
    );

    expect(plainAwsDependencies.logger).toBeDefined();
  });
});