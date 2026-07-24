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
  putObject(object: Omit<StoredObject, 'createdAt' | 'updatedAt'>): Promise<void>;
  getObject(bucket: string, key: string): Promise<StoredObject | undefined>;
  moveObject(sourceBucket: string, sourceKey: string, targetBucket: string, targetKey: string): Promise<void>;
  listObjects?(bucket: string, prefix?: string): Promise<StoredObject[]>;
}

export const buildObjectKey = (bucket: string, key: string): string => `${bucket}/${key}`;

export class InMemoryObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, StoredObject>();

  async putObject(object: Omit<StoredObject, 'createdAt' | 'updatedAt'>): Promise<void> {
    const now = new Date().toISOString();
    this.objects.set(buildObjectKey(object.bucket, object.key), { ...object, createdAt: now, updatedAt: now });
  }

  async getObject(bucket: string, key: string): Promise<StoredObject | undefined> {
    return this.objects.get(buildObjectKey(bucket, key));
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

    this.objects.delete(buildObjectKey(sourceBucket, sourceKey));
  }

  async listObjects(bucket: string, prefix = ''): Promise<StoredObject[]> {
    return Array.from(this.objects.values()).filter(
      (object) => object.bucket === bucket && object.key.startsWith(prefix),
    );
  }
}