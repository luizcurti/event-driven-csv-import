import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import type { LambdaClient } from '@aws-sdk/client-lambda';
import { InvokeCommand } from '@aws-sdk/client-lambda';
import type { AppDependencies } from '../../shared/dependencies.js';
import { createAwsDependencies, resolveAwsClients } from '../../shared/dependencies.js';
import { createWorkerHandler } from './handler.js';
import type { ChunkMessage } from '../../shared/types.js';

/**
 * Real AWS Lambda entrypoint, triggered by the SQS event source mapping.
 * Processes each chunk message and, once every chunk for the import has
 * been processed, invokes the Aggregator Lambda asynchronously.
 */
export const createWorkerEntryHandler = (
  dependencies: AppDependencies,
  lambdaClient: Pick<LambdaClient, 'send'>,
  aggregatorFunctionName: string,
) => {
  const workerHandler = createWorkerHandler(dependencies);

  const maybeInvokeAggregator = async (importId: string): Promise<void> => {
    if (!aggregatorFunctionName) {
      return;
    }

    const currentImport = await dependencies.store.getImport(importId);
    if (!currentImport || currentImport.processedChunks < currentImport.totalChunks) {
      return;
    }

    await lambdaClient.send(
      new InvokeCommand({
        FunctionName: aggregatorFunctionName,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ importId })),
      }),
    );
  };

  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

    for (const record of event.Records) {
      try {
        const message = JSON.parse(record.body) as ChunkMessage;
        await workerHandler(message);
        await maybeInvokeAggregator(message.importId);
      } catch {
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }

    return { batchItemFailures };
  };
};

const awsClients = resolveAwsClients();
export const handler = createWorkerEntryHandler(
  createAwsDependencies(),
  awsClients.lambda,
  process.env.AGGREGATOR_FUNCTION_NAME ?? '',
);
