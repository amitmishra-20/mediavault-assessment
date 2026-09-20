export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfter?: number;
  readonly requestId?: string;

  constructor(code: string, message: string, status: number, retryAfter?: number, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
    this.requestId = requestId;
  }
}

// Retry 429/503/500 (write_failed repeatable); 400/409/422 never.
const RETRYABLE_STATUS: ReadonlySet<number> = new Set([429, 503, 500]);

export function isRetryable(err: unknown): err is ApiError {
  if (err instanceof ApiError) {
    return RETRYABLE_STATUS.has(err.status);
  }
  return err instanceof TypeError; // fetch network failure
}

export function apiMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}