import { describe, expect, it } from '@jest/globals';
import { createDependencies } from '../shared/dependencies.js';
import { createUploadHandler } from '../lambdas/upload/handler.js';
import { createSplitHandler } from '../lambdas/split/handler.js';
import { createWorkerHandler } from '../lambdas/worker/handler.js';
import { createAggregatorHandler } from '../lambdas/aggregator/handler.js';
import { createStatusHandler } from '../lambdas/status/handler.js';

describe('import flow', () => {
  it('processes a csv end to end in memory', async () => {
    const dependencies = createDependencies();
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

    const uploadBody = JSON.parse(uploadResponse.body ?? '{}') as { importId: string };
    const splitResult = await splitHandler(uploadBody.importId);

    expect(splitResult.totalChunks).toBe(1);

    await workerHandler(splitResult.messages[0] as (typeof splitResult.messages)[number]);
    const aggregation = await aggregatorHandler(uploadBody.importId);
    const status = await statusHandler(uploadBody.importId);

    expect(aggregation.status).toBe('COMPLETED');
    expect(JSON.parse(status.body ?? '{}')).toMatchObject({
      id: uploadBody.importId,
      status: 'COMPLETED',
    });
  });
});