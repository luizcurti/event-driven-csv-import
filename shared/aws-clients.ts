import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { SFNClient } from '@aws-sdk/client-sfn';
import { SQSClient } from '@aws-sdk/client-sqs';

export interface AwsClientOptions {
  region: string;
  endpoint?: string;
}

export interface AwsClients {
  s3: S3Client;
  dynamoDb: DynamoDBDocumentClient;
  sqs: SQSClient;
  eventBridge: EventBridgeClient;
  stepFunctions: SFNClient;
}

const createSharedConfig = (options: AwsClientOptions): {
  endpoint?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
} => {
  if (!options.endpoint) {
    return {};
  }

  return {
    endpoint: options.endpoint,
    credentials: {
      accessKeyId: 'test',
      secretAccessKey: 'test',
    },
  };
};

export const createAwsClients = (options: AwsClientOptions): AwsClients => {
  const sharedConfig = createSharedConfig(options);

  return {
    s3: new S3Client({
      region: options.region,
      forcePathStyle: Boolean(options.endpoint),
      ...sharedConfig,
    }),
    dynamoDb: DynamoDBDocumentClient.from(
      new DynamoDBClient({
        region: options.region,
        ...sharedConfig,
      }),
    ),
    sqs: new SQSClient({
      region: options.region,
      ...sharedConfig,
    }),
    eventBridge: new EventBridgeClient({
      region: options.region,
      ...sharedConfig,
    }),
    stepFunctions: new SFNClient({
      region: options.region,
      ...sharedConfig,
    }),
  };
};