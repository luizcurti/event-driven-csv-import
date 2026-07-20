import { loadConfig, type AppConfig } from './config.js';
import { createLogger, type Logger } from './logger.js';
import { InMemoryObjectStorage, type ObjectStorage } from './object-storage.js';
import { InMemoryImportStore, type ImportStore } from './repository.js';
import { createAwsClients } from './aws-clients.js';
import { DynamoDbImportStore } from './dynamodb-import-store.js';
import { S3ObjectStorage } from './s3-object-storage.js';

export interface AppDependencies {
  config: AppConfig;
  logger: Logger;
  store: ImportStore;
  storage: ObjectStorage;
}

export const createDependencies = (overrides: Partial<AppDependencies> = {}): AppDependencies => ({
  config: overrides.config ?? loadConfig(),
  logger: overrides.logger ?? createLogger('app'),
  store: overrides.store ?? new InMemoryImportStore(),
  storage: overrides.storage ?? new InMemoryObjectStorage(),
});

export const createAwsDependencies = (overrides: Partial<AppDependencies> = {}, env: NodeJS.ProcessEnv = process.env): AppDependencies => {
  const config = overrides.config ?? loadConfig(env);
  const endpoint = env.LOCALSTACK_ENDPOINT ?? env.AWS_ENDPOINT_URL;
  const region = env.AWS_REGION ?? 'us-east-1';
  const clients = endpoint ? createAwsClients({ region, endpoint }) : createAwsClients({ region });
  const tableName = env.IMPORTS_TABLE_NAME ?? `${config.environment}-imports`;

  return {
    config,
    logger: overrides.logger ?? createLogger('app', { mode: endpoint ? 'localstack' : 'aws' }),
    store: overrides.store ?? new DynamoDbImportStore(clients.dynamoDb, tableName),
    storage: overrides.storage ?? new S3ObjectStorage(clients.s3, config.importsBucket),
  };
};