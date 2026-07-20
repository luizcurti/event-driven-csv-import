import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, type PutObjectCommandInput, type S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import type { ObjectStorage, StoredObject } from './object-storage.js';

const objectKey = (bucket: string, key: string): string => `${bucket}/${key}`;

const readStream = async (stream: Readable): Promise<string> => {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf8');
};

const bodyToString = async (body: unknown): Promise<string> => {
  if (typeof body === 'string') {
    return body;
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body).toString('utf8');
  }

  if (body instanceof Readable) {
    return readStream(body);
  }

  throw new Error('Unsupported S3 body type.');
};

export class S3ObjectStorage implements ObjectStorage {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async putObject(object: Omit<StoredObject, 'createdAt' | 'updatedAt'>): Promise<void> {
    const input: PutObjectCommandInput = {
      Bucket: object.bucket,
      Key: object.key,
      Body: object.body,
      ContentType: object.contentType,
    };

    if (object.metadata) {
      input.Metadata = object.metadata;
    }

    await this.client.send(new PutObjectCommand(input));
  }

  async getObject(bucket: string, key: string): Promise<StoredObject | undefined> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );

      if (!response.Body) {
        return undefined;
      }

      const storedObject: StoredObject = {
        bucket,
        key,
        body: await bodyToString(response.Body),
        contentType: response.ContentType ?? 'application/octet-stream',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      if (response.Metadata) {
        storedObject.metadata = response.Metadata;
      }

      return storedObject;
    } catch {
      return undefined;
    }
  }

  async moveObject(sourceBucket: string, sourceKey: string, targetBucket: string, targetKey: string): Promise<void> {
    const current = await this.getObject(sourceBucket, sourceKey);
    if (!current) {
      return;
    }

    const nextObject: Omit<StoredObject, 'createdAt' | 'updatedAt'> = {
      bucket: targetBucket,
      key: targetKey,
      body: current.body,
      contentType: current.contentType,
    };

    if (current.metadata) {
      nextObject.metadata = current.metadata;
    }

    await this.putObject(nextObject);
  }

  async listObjects(bucket: string, prefix = ''): Promise<StoredObject[]> {
    const response = await this.client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
      }),
    );

    return (response.Contents ?? []).flatMap((item) => {
      if (!item.Key) {
        return [];
      }

      return [
        {
          bucket,
          key: item.Key,
          body: '',
          contentType: 'application/octet-stream',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
    });
  }
}

export const createBucketObjectKey = objectKey;