import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './errors';
import { MAX_RETRIES, RETRY_BASE_MS, RETRY_CAP_MS, backoffMs, shouldRetry, withRetry } from './retry';

function timingError(status: number, retryAfter?: number) {
  return new ApiError(String(status), 'x', status, retryAfter);
}

describe('backoffMs', () => {
  it('grows exponentially, respects the cap', () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      for (let i = 0; i < 50; i++) {
        const value = backoffMs(attempt);
        const exponential = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** attempt);
        expect(value).toBeGreaterThanOrEqual(Math.floor(exponential * 0.5));
        expect(value).toBeLessThanOrEqual(Math.ceil(exponential * 1.5));
      }
    }
  });

  it('honours Retry-After when the server sets it', () => {
    for (let i = 0; i < 20; i++) {
      expect(backoffMs(0, 3)).toBeGreaterThanOrEqual(1500);
      expect(backoffMs(0, 3)).toBeLessThanOrEqual(4500);
    }
  });

  it('never sleeps longer than the cap even with a huge Retry-After', () => {
    for (let i = 0; i < 20; i++) {
      expect(backoffMs(9, 999)).toBeLessThanOrEqual(Math.ceil(RETRY_CAP_MS * 1.5));
    }
  });
});

describe('shouldRetry', () => {
  it('retries 503, 429, write-500 and network failures', () => {
    expect(shouldRetry(0, timingError(503))).toBe(true);
    expect(shouldRetry(0, timingError(429))).toBe(true);
    expect(shouldRetry(0, timingError(500))).toBe(true);
    expect(shouldRetry(0, new TypeError('failed to fetch'))).toBe(true);
  });

  it('never retries 400, 409 or 422', () => {
    expect(shouldRetry(0, timingError(400))).toBe(false);
    expect(shouldRetry(0, timingError(409))).toBe(false);
    expect(shouldRetry(0, timingError(422))).toBe(false);
  });

  it('caps the attempts', () => {
    expect(shouldRetry(MAX_RETRIES, timingError(503))).toBe(true); // attempt index MAX_RETRIES is allowed
    expect(shouldRetry(MAX_RETRIES + 1, timingError(503))).toBe(false);
  });
});

describe('withRetry', () => {
  it('resolves on success without retrying', async () => {
    const fn = vi.fn(async () => 'ok');
    await expect(withRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a flaky write (500) then succeeds', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw timingError(500);
      return 'saved';
    });
    await expect(withRetry(fn)).resolves.toBe('saved');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('gives up after MAX_RETRIES', async () => {
    const fn = vi.fn(async () => {
      throw timingError(500);
    });
    await expect(withRetry(fn)).rejects.toBeInstanceOf(ApiError);
    expect(fn).toHaveBeenCalledTimes(MAX_RETRIES + 1);
  });

  it('does not retry a 409 version conflict', async () => {
    const fn = vi.fn(async () => {
      throw timingError(409);
    });
    await expect(withRetry(fn)).rejects.toBeInstanceOf(ApiError);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});