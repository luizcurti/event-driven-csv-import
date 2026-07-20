type LogLevel = 'info' | 'warn' | 'error';

export interface LogContext {
  [key: string]: unknown;
}

export class Logger {
  constructor(
    private readonly scope: string,
    private readonly baseContext: LogContext = {},
  ) {}

  child(context: LogContext): Logger {
    return new Logger(this.scope, { ...this.baseContext, ...context });
  }

  info(message: string, context: LogContext = {}): void {
    this.write('info', message, context);
  }

  warn(message: string, context: LogContext = {}): void {
    this.write('warn', message, context);
  }

  error(message: string, context: LogContext = {}): void {
    this.write('error', message, context);
  }

  private write(level: LogLevel, message: string, context: LogContext): void {
    const payload = {
      timestamp: new Date().toISOString(),
      level,
      scope: this.scope,
      message,
      ...this.baseContext,
      ...context,
    };

    const output = JSON.stringify(payload);
    const emit = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
    emit(output);
  }
}

export const createLogger = (scope: string, baseContext: LogContext = {}): Logger => new Logger(scope, baseContext);