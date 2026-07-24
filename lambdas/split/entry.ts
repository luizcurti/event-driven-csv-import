import type { SQSClient } from '@aws-sdk/client-sqs';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import type { AppDependencies } from '../../shared/dependencies.js';
import { createAwsDependencies, resolveAwsClients } from '../../shared/dependencies.js';
import { createSplitHandler, type SplitResult } from './handler.js';

interface S3ObjectCreatedDetail {
  object: { key: string };
}

export interface SplitEntryInput {
  importId?: string;
  detail?: S3ObjectCreatedDetail;
}

const extractImportId = (event: SplitEntryInput): string => {
  if (event.importId) {
    return event.importId;
  }

  const key = event.detail?.object.key ?? '';
  const importId = key.split('/')[1];

  if (!importId) {
    throw new Error(`Unable to extract importId from object key "${key}".`);
  }

  return importId;
};

/**
 * Real AWS Lambda entrypoint, invoked by Step Functions after EventBridge
 * receives the S3 ObjectCreated event. Splits the CSV and enqueues one SQS
 * message per chunk for the Worker Lambdas to consume.
 */
export const createSplitEntryHandler = (
  dependencies: AppDependencies,
  sqsClient: Pick<SQSClient, 'send'>,
  queueUrl: string,
) => {
  const splitHandler = createSplitHandler(dependencies);

  return async (event: SplitEntryInput): Promise<SplitResult> => {
    const importId = extractImportId(event);
    const result = await splitHandler(importId);

    for (const message of result.messages) {
      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(message),
        }),
      );
    }

    return result;
  };
};

const awsClients = resolveAwsClients();
export const handler = createSplitEntryHandler(createAwsDependencies(), awsClients.sqs, process.env.PROCESSING_QUEUE_URL ?? '');
