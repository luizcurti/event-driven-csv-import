export interface AppConfig {
  environment: string;
  importsBucket: string;
  chunkSize: number;
  maxFileSizeBytes: number;
  allowedMimeTypes: string[];
  workerConcurrency: number;
}

const parseNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseList = (value: string | undefined, fallback: string[]): string[] => {
  if (!value) {
    return fallback;
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => ({
  environment: env.NODE_ENV ?? 'development',
  importsBucket: env.IMPORTS_BUCKET ?? 'event-driven-data-ingestion',
  chunkSize: parseNumber(env.CHUNK_SIZE, 5000),
  maxFileSizeBytes: parseNumber(env.MAX_FILE_SIZE_BYTES, 50 * 1024 * 1024),
  allowedMimeTypes: parseList(env.ALLOWED_MIME_TYPES, ['text/csv', 'application/csv', 'text/plain']),
  workerConcurrency: parseNumber(env.WORKER_CONCURRENCY, 10),
});