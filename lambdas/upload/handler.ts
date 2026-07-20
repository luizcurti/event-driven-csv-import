import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { AppDependencies } from '../../shared/dependencies.js';
import { createId } from '../../shared/id.js';
import { InvalidFileException, ValidationException } from '../../shared/errors.js';
import { validateUploadFile } from '../../shared/validation.js';
import type { ImportRecord } from '../../shared/types.js';

interface UploadedFile {
  fileName: string;
  contentType: string;
  body: string;
}

const toJsonResponse = (statusCode: number, body: Record<string, unknown>): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: {
    'content-type': 'application/json',
  },
  body: JSON.stringify(body),
});

const getHeader = (headers: Record<string, string | undefined>, name: string): string | undefined => {
  const targetName = name.toLowerCase();
  return Object.entries(headers).find(([key]) => key.toLowerCase() === targetName)?.[1];
};

const parseMultipartFile = (body: string, contentType: string): UploadedFile => {
  const boundaryMatch = /boundary=([^;]+)/iu.exec(contentType);

  if (!boundaryMatch) {
    throw new InvalidFileException('Multipart boundary is missing.');
  }

  const boundary = `--${boundaryMatch[1]}`;
  const parts = body.split(boundary).map((part) => part.trim()).filter((part) => part && part !== '--');

  for (const part of parts) {
    const [rawHeaders, ...rawBodyParts] = part.split('\r\n\r\n');
    if (!rawHeaders || !rawBodyParts.length) {
      continue;
    }

    const headers = rawHeaders.split('\r\n');
    const disposition = headers.find((line) => line.toLowerCase().startsWith('content-disposition'));
    if (!disposition || !disposition.includes('name="file"')) {
      continue;
    }

    const fileNameMatch = /filename="([^"]+)"/iu.exec(disposition);
    const partContentType = headers.find((line) => line.toLowerCase().startsWith('content-type'))?.split(':')[1]?.trim() ?? 'text/csv';
    const rawContent = rawBodyParts.join('\r\n\r\n').replace(/\r\n--$/u, '').trim();

    return {
      fileName: fileNameMatch?.[1] ?? 'import.csv',
      contentType: partContentType,
      body: rawContent,
    };
  }

  throw new InvalidFileException('File field not found in multipart payload.');
};

const parseUploadInput = (event: APIGatewayProxyEventV2): UploadedFile => {
  const contentType = getHeader(event.headers, 'content-type') ?? 'application/json';
  const body = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : event.body ?? '';

  if (contentType.includes('multipart/form-data')) {
    return parseMultipartFile(body, contentType);
  }

  try {
    const payload = JSON.parse(body) as { fileName?: unknown; contentType?: unknown; body?: unknown };

    if (
      typeof payload.fileName !== 'string' ||
      typeof payload.contentType !== 'string' ||
      typeof payload.body !== 'string'
    ) {
      throw new Error('Invalid JSON payload.');
    }

    return {
      fileName: payload.fileName,
      contentType: payload.contentType,
      body: payload.body,
    };
  } catch {
    throw new ValidationException('Upload payload must be multipart/form-data or a valid JSON envelope.');
  }
};

export const createUploadHandler = ({ config, logger, store, storage }: AppDependencies) => {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    const correlationId = getHeader(event.headers, 'x-correlation-id') ?? createId();
    const uploadedFile = parseUploadInput(event);
    const sizeBytes = Buffer.byteLength(uploadedFile.body, 'utf8');

    validateUploadFile(
      uploadedFile.fileName,
      uploadedFile.contentType,
      sizeBytes,
      config.allowedMimeTypes,
      config.maxFileSizeBytes,
    );

    const importId = createId();
    const key = `incoming/${importId}/${uploadedFile.fileName}`;
    const now = new Date().toISOString();

    const record: ImportRecord = {
      id: importId,
      correlationId,
      filename: uploadedFile.fileName,
      bucket: config.importsBucket,
      key,
      status: 'UPLOADED',
      createdAt: now,
      updatedAt: now,
      totalChunks: 0,
      processedChunks: 0,
      totalRecords: 0,
      processedRecords: 0,
      failedRecords: 0,
      successRecords: 0,
      chunkSize: config.chunkSize,
    };

    await store.saveImport(record);
    await storage.putObject({
      bucket: config.importsBucket,
      key,
      body: uploadedFile.body,
      contentType: uploadedFile.contentType,
      metadata: {
        importId,
        correlationId,
        filename: uploadedFile.fileName,
      },
    });

    logger.info('Import uploaded', {
      importId,
      correlationId,
      filename: uploadedFile.fileName,
      sizeBytes,
      status: 'UPLOADED',
    });

    return toJsonResponse(201, {
      importId,
      status: 'UPLOADED',
    });
  };
};