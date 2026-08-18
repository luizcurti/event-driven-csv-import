import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { withMetrics } from '../shared/metrics.js';

const listen = (server: Server): Promise<number> =>
  new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });

const closeServer = (server: Server): Promise<void> => new Promise((resolve) => server.close(() => resolve()));

describe('withMetrics', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('records a successful invocation without pushing when PUSHGATEWAY_URL is unset', async () => {
    const handler = withMetrics('upload', async (event: { value: number }) => event.value * 2, {});
    await expect(handler({ value: 2 })).resolves.toBe(4);
  });

  it('falls back to process.env when no env is provided', async () => {
    const handler = withMetrics('upload', async () => 'ok');
    await expect(handler(undefined)).resolves.toBe('ok');
  });

  it('pushes metrics to the gateway on success', async () => {
    const requests: string[] = [];
    const server = createServer((req, res) => {
      requests.push(req.url ?? '');
      req.resume();
      req.on('end', () => {
        res.writeHead(200);
        res.end();
      });
    });
    const port = await listen(server);

    const handler = withMetrics('upload', async () => 'ok', { PUSHGATEWAY_URL: `http://127.0.0.1:${port}` });
    await expect(handler(undefined)).resolves.toBe('ok');
    await closeServer(server);

    expect(requests.some((url) => url.includes('/job/upload'))).toBe(true);
  });

  it('logs a warning and does not throw when the push itself fails', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const handler = withMetrics('upload', async () => 'ok', { PUSHGATEWAY_URL: 'http://127.0.0.1:1' });

    await expect(handler(undefined)).resolves.toBe('ok');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(warnSpy.mock.calls[0]?.[0] as string)).toMatchObject({ level: 'warn', functionName: 'upload' });
  });

  it('records the error outcome and rethrows when the handler fails', async () => {
    const handler = withMetrics(
      'worker',
      async () => {
        throw new Error('boom');
      },
      {},
    );

    await expect(handler(undefined)).rejects.toThrow('boom');
  });

  it('still pushes metrics and rethrows when the handler fails with a pushgateway configured', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const handler = withMetrics(
      'worker',
      async () => {
        throw new Error('boom');
      },
      { PUSHGATEWAY_URL: 'http://127.0.0.1:1' },
    );

    await expect(handler(undefined)).rejects.toThrow('boom');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
