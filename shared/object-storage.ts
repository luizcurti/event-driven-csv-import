export interface StoredObject {
  bucket: string;
  key: string;
  body: string;
  contentType: string;
  metadata?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface ObjectStorage {
  putObject(
    object: Omit<StoredObject, 'createdAt' | 'updatedAt'>,
  ): Promise<void>;
  getObject(bucket: string, key: string): Promise<StoredObject | undefined>;
}

export const buildObjectKey = (bucket: string, key: string): string =>
  `${bucket}/${key}`;

export class InMemoryObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, StoredObject>();

  async putObject(
    object: Omit<StoredObject, 'createdAt' | 'updatedAt'>,
  ): Promise<void> {
    const now = new Date().toISOString();
    this.objects.set(buildObjectKey(object.bucket, object.key), {
      ...object,
      createdAt: now,
      updatedAt: now,
    });
  }

  async getObject(
    bucket: string,
    key: string,
  ): Promise<StoredObject | undefined> {
    return this.objects.get(buildObjectKey(bucket, key));
  }
}
