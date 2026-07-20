export type ImportStatus =
  | 'UPLOADED'
  | 'PROCESSING'
  | 'SPLITTING'
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'PARTIAL_SUCCESS'
  | 'CANCELLED';

export interface ImportRecord {
  id: string;
  correlationId: string;
  filename: string;
  bucket: string;
  key: string;
  status: ImportStatus;
  createdAt: string;
  updatedAt: string;
  totalChunks: number;
  processedChunks: number;
  totalRecords: number;
  processedRecords: number;
  failedRecords: number;
  successRecords: number;
  executionTimeMs?: number;
  chunkSize: number;
}

export interface ChunkMessage {
  importId: string;
  chunkNumber: number;
  bucket: string;
  key: string;
  totalChunks: number;
  correlationId: string;
}

export interface ChunkResult {
  importId: string;
  chunkNumber: number;
  workerId: string;
  requestId: string;
  status: 'COMPLETED' | 'FAILED' | 'PARTIAL_SUCCESS';
  recordsProcessed: number;
  successRecords: number;
  failedRecords: number;
  errors: string[];
  durationMs: number;
  correlationId: string;
}

export interface CustomerRecord {
  customerId: string;
  name: string;
  email: string;
  cpf: string;
  age: number;
  status: 'VALID' | 'INVALID';
}

export interface ValidationIssue {
  field: string;
  message: string;
}