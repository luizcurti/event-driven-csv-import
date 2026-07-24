import { loadConfig, type AppConfig } from './config.js';
import { createLogger, type Logger } from './logger.js';
import { InMemoryObjectStorage, type ObjectStorage } from './object-storage.js';
import { InMemoryImportStore, type ImportStore } from './repository.js';
import { createAwsClients, type AwsClients } from './aws-clients.js';
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

const resolveEndpoint = (env: NodeJS.ProcessEnv): string | undefined => {
  if (env.LOCALSTACK_ENDPOINT) {
    return env.LOCALSTACK_ENDPOINT;
  }
  if (env.AWS_ENDPOINT_URL) {
    return env.AWS_ENDPOINT_URL;
  }
  // LocalStack automatically injects LOCALSTACK_HOSTNAME (and EDGE_PORT) into
  // Lambda functions it executes, so functions deployed via Terraform can
  // reach sibling LocalStack services without an explicit endpoint override.
  if (env.LOCALSTACK_HOSTNAME) {
    return `http://${env.LOCALSTACK_HOSTNAME}:${env.EDGE_PORT ?? '4566'}`;
  }
  return undefined;
};

export const resolveAwsClients = (env: NodeJS.ProcessEnv = process.env): AwsClients => {
  const endpoint = resolveEndpoint(env);
  const region = env.AWS_REGION ?? 'us-east-1';
  return endpoint ? createAwsClients({ region, endpoint }) : createAwsClients({ region });
};

export const createAwsDependencies = (overrides: Partial<AppDependencies> = {}, env: NodeJS.ProcessEnv = process.env): AppDependencies => {
  const config = overrides.config ?? loadConfig(env);
  const endpoint = resolveEndpoint(env);
  const clients = resolveAwsClients(env);
  const tableName = env.IMPORTS_TABLE_NAME ?? `${config.environment}-imports`;

  return {
    config,
    logger: overrides.logger ?? createLogger('app', { mode: endpoint ? 'localstack' : 'aws' }),
    store: overrides.store ?? new DynamoDbImportStore(clients.dynamoDb, tableName),
    storage: overrides.storage ?? new S3ObjectStorage(clients.s3, config.importsBucket),
  };
};