export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidFileException extends AppError {
  constructor(message = 'Invalid file.') {
    super(message, 'INVALID_FILE', 400);
  }
}

export class ValidationException extends AppError {
  constructor(message = 'Validation failed.') {
    super(message, 'VALIDATION_ERROR', 400);
  }
}

export class ChunkProcessingException extends AppError {
  constructor(message = 'Chunk processing failed.') {
    super(message, 'CHUNK_PROCESSING_ERROR', 500);
  }
}

export class ImportNotFoundException extends AppError {
  constructor(message = 'Import not found.') {
    super(message, 'IMPORT_NOT_FOUND', 404);
  }
}

export class StorageException extends AppError {
  constructor(message = 'Storage error.') {
    super(message, 'STORAGE_ERROR', 500);
  }
}