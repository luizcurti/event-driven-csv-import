import { Counter, Histogram, Pushgateway, Registry } from 'prom-client';

const registry = new Registry();

const invocationsTotal = new Counter({
  name: 'lambda_invocations_total',
  help: 'Total Lambda invocations by function and outcome.',
  labelNames: ['function', 'outcome'] as const,
  registers: [registry],
});

const durationSeconds = new Histogram({
  name: 'lambda_duration_seconds',
  help: 'Lambda invocation duration in seconds.',
  labelNames: ['function'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry],
});

/**
 * Wraps a Lambda entrypoint with invocation/duration metrics, pushed to a
 * Prometheus Pushgateway (Lambdas are too short-lived to be scraped directly).
 * Only pushes when PUSHGATEWAY_URL is set, so real AWS deployments (which have
 * no Pushgateway) pay no cost and take no risk from this. A push failure is
 * logged and swallowed - losing a metrics sample must never fail the invocation.
 */
export const withMetrics = <Event, Result>(
  functionName: string,
  handler: (event: Event) => Promise<Result>,
  env: NodeJS.ProcessEnv = process.env,
): ((event: Event) => Promise<Result>) => {
  const pushgatewayUrl = env.PUSHGATEWAY_URL;
  const pushgateway = pushgatewayUrl
    ? new Pushgateway(pushgatewayUrl, {}, registry)
    : undefined;

  return async (event: Event): Promise<Result> => {
    const startedAt = process.hrtime.bigint();
    let outcome: 'success' | 'error' = 'success';

    try {
      return await handler(event);
    } catch (error) {
      outcome = 'error';
      throw error;
    } finally {
      const elapsedSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      invocationsTotal.labels(functionName, outcome).inc();
      durationSeconds.labels(functionName).observe(elapsedSeconds);

      if (pushgateway) {
        try {
          await pushgateway.pushAdd({ jobName: functionName });
        } catch (pushError) {
          console.warn(
            JSON.stringify({
              level: 'warn',
              message: 'Failed to push metrics to Pushgateway',
              functionName,
              error: String(pushError),
            }),
          );
        }
      }
    }
  };
};
