import { ApiError, isRetryable } from './errors';

export const MAX_RETRIES = 2; // attempts after the first
export const RETRY_BASE_MS = 500;
export const RETRY_CAP_MS = 8000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Exponential backoff with full jitter. */
export function backoffMs(attempt: number, retryAfterSec?: number): number {
  const exponential = RETRY_BASE_MS * 2 ** attempt;
  const raw = retryAfterSec ? Math.max(retryAfterSec * 1000, exponential) : exponential;
  return Math.round(Math.min(RETRY_CAP_MS, raw) * (0.5 + Math.random()));
}

/** TanStack Query hooks into this for reads. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  return failureCount <= MAX_RETRIES && isRetryable(error);
}

/** For writes that are not driven by TanStack Query (single-asset PATCH and bulk runs). */
export function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const run = async (attempt: number): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= MAX_RETRIES || !isRetryable(err)) throw err;
      const retryAfterSec = err instanceof ApiError ? err.retryAfter : undefined;
      await sleep(backoffMs(attempt, retryAfterSec));
      return run(attempt + 1);
    }
  };
  return run(0);
}