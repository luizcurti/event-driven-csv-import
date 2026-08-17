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

  const maybeInvokeAggregator = async (importId: string, processedChunks: number, totalChunks: number): Promise<void> => {
    if (!aggregatorFunctionName || processedChunks < totalChunks) {
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
        const workerResult = await workerHandler(message);
        // Using the counter value returned by this exact invocation (rather
        // than re-reading the import afterwards) is what makes this safe
        // under concurrent Workers: it's the atomic result of *this* chunk's
        // increment, not a snapshot another Worker could have already moved
        // past — so only the Worker that truly finishes the last chunk
        // invokes the Aggregator.
        await maybeInvokeAggregator(message.importId, workerResult.processedChunks, message.totalChunks);
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
