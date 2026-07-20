import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { CreateTableCommand, DescribeTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  CreateEventBusCommand,
  DescribeEventBusCommand,
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import { CreateQueueCommand, GetQueueUrlCommand, SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import {
  CreateStateMachineCommand,
  ListStateMachinesCommand,
  SFNClient,
  StartExecutionCommand,
} from '@aws-sdk/client-sfn';
import { describe, beforeAll, expect, it } from '@jest/globals';
import { createAwsClients } from '../shared/aws-clients.js';
import { createAwsDependencies } from '../shared/dependencies.js';
import { createUploadHandler } from '../lambdas/upload/handler.js';
import { createSplitHandler } from '../lambdas/split/handler.js';
import { createWorkerHandler } from '../lambdas/worker/handler.js';
import { createAggregatorHandler } from '../lambdas/aggregator/handler.js';
import { createStatusHandler } from '../lambdas/status/handler.js';

const endpoint = process.env.LOCALSTACK_ENDPOINT ?? process.env.AWS_ENDPOINT_URL;
const suite = endpoint ? describe : describe.skip;

const region = process.env.AWS_REGION ?? 'us-east-1';
const bucketName = process.env.IMPORTS_BUCKET ?? 'event-driven-data-ingestion-local';
const tableName = process.env.IMPORTS_TABLE_NAME ?? 'event-driven-data-ingestion-local-imports';
const queueName = process.env.PROCESSING_QUEUE_NAME ?? 'event-driven-data-ingestion-local-processing';
const busName = process.env.EVENT_BUS_NAME ?? 'event-driven-data-ingestion-local-bus';
const stateMachineName = process.env.STATE_MACHINE_NAME ?? 'event-driven-data-ingestion-local-orchestration';
const stepFunctionsRoleArn =
  process.env.STEP_FUNCTIONS_ROLE_ARN ?? 'arn:aws:iam::000000000000:role/service-role/stepfunctions-local';

const stateMachineDefinition = JSON.stringify({
  StartAt: 'Done',
  States: {
    Done: {
      Type: 'Succeed',
    },
  },
});

let clients: ReturnType<typeof createAwsClients>;
let queueUrl = '';
let stateMachineArn = '';

const ensureBucket = async (client: S3Client): Promise<void> => {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucketName }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucketName }));
  }
};

const ensureTable = async (client: DynamoDBClient): Promise<void> => {
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
  } catch {
    await client.send(
      new CreateTableCommand({
        TableName: tableName,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [
          { AttributeName: 'pk', AttributeType: 'S' },
          { AttributeName: 'sk', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'pk', KeyType: 'HASH' },
          { AttributeName: 'sk', KeyType: 'RANGE' },
        ],
      }),
    );
  }
};

const ensureQueue = async (client: SQSClient): Promise<string> => {
  try {
    const current = await client.send(new GetQueueUrlCommand({ QueueName: queueName }));
    return current.QueueUrl ?? '';
  } catch {
    const created = await client.send(new CreateQueueCommand({ QueueName: queueName }));
    return created.QueueUrl ?? '';
  }
};

const ensureEventBus = async (client: EventBridgeClient): Promise<void> => {
  try {
    await client.send(new DescribeEventBusCommand({ Name: busName }));
  } catch {
    await client.send(new CreateEventBusCommand({ Name: busName }));
  }
};

const ensureStateMachine = async (client: SFNClient): Promise<string> => {
  const current = await client.send(new ListStateMachinesCommand({}));
  const existing = current.stateMachines?.find((stateMachine) => stateMachine.name === stateMachineName);

  if (existing?.stateMachineArn) {
    return existing.stateMachineArn;
  }

  const created = await client.send(
    new CreateStateMachineCommand({
      name: stateMachineName,
      definition: stateMachineDefinition,
      roleArn: stepFunctionsRoleArn,
      type: 'STANDARD',
    }),
  );

  return created.stateMachineArn ?? '';
};

suite('localstack integration flow', () => {
  beforeAll(async () => {
    if (!endpoint) {
      return;
    }

    process.env.LOCALSTACK_ENDPOINT = endpoint;
    process.env.IMPORTS_BUCKET = bucketName;
    process.env.IMPORTS_TABLE_NAME = tableName;
    process.env.NODE_ENV = 'localstack';

    clients = createAwsClients({ region, endpoint });
    await ensureBucket(clients.s3);
    await ensureTable(new DynamoDBClient({ region, endpoint, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } }));
    queueUrl = await ensureQueue(clients.sqs);
    await ensureEventBus(clients.eventBridge);
    stateMachineArn = await ensureStateMachine(clients.stepFunctions);
  });

  it('processes a csv through localstack-backed storage', async () => {
    if (!endpoint) {
      return;
    }

    const dependencies = createAwsDependencies();
    const uploadHandler = createUploadHandler(dependencies);
    const splitHandler = createSplitHandler(dependencies);
    const workerHandler = createWorkerHandler(dependencies);
    const aggregatorHandler = createAggregatorHandler(dependencies);
    const statusHandler = createStatusHandler(dependencies);

    const uploadResponse = await uploadHandler({
      version: '2.0',
      routeKey: 'POST /imports',
      rawPath: '/imports',
      rawQueryString: '',
      headers: {
        'content-type': 'application/json',
      },
      requestContext: {} as never,
      isBase64Encoded: false,
      body: JSON.stringify({
        fileName: 'customers.csv',
        contentType: 'text/csv',
        body: ['customerId,name,email,cpf,age', '1,Alice,alice@example.com,52998224725,30'].join('\n'),
      }),
    });

    expect(uploadResponse.statusCode).toBe(201);

    const { importId } = JSON.parse(uploadResponse.body ?? '{}') as { importId: string };
    await clients.eventBridge.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: busName,
            Source: 'event-driven-data-ingestion.upload',
            DetailType: 'ObjectCreated',
            Detail: JSON.stringify({ importId }),
          },
        ],
      }),
    );

    await clients.stepFunctions.send(
      new StartExecutionCommand({
        stateMachineArn,
        input: JSON.stringify({ importId, queueUrl }),
      }),
    );

    const splitResult = await splitHandler(importId);

    for (const message of splitResult.messages) {
      await clients.sqs.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(message),
        }),
      );

      await workerHandler(message);
    }

    const aggregation = await aggregatorHandler(importId);
    const status = await statusHandler(importId);

    expect(aggregation.status).toBe('COMPLETED');
    expect(JSON.parse(status.body ?? '{}')).toMatchObject({
      id: importId,
      status: 'COMPLETED',
    });
  });
});