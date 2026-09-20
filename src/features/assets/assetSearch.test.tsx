import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from '@/App';
import type { Asset, AssetPage } from '@/lib/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Call = { url: string; signal: AbortSignal };
const calls: Call[] = [];
const collectors: Array<{ d: ReturnType<typeof deferred<Response>>; call: Call }> = [];

function asset(id: string, name: string, status: Asset['status'] = 'draft'): Asset {
  return {
    id,
    name,
    kind: 'image',
    status,
    tags: [],
    collectionId: 'c_01',
    owner: { id: 'u_01', name: 'Owen' },
    sizeBytes: 1024,
    width: 1280,
    height: 800,
    durationSec: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    version: 1,
    hasThumbnail: true,
  };
}

function page(items: Asset[], total: number, nextCursor: string | null = null): AssetPage {
  return { items, total, nextCursor };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function installFetchMock() {
  calls.length = 0;
  collectors.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const call: Call = { url, signal: init.signal ?? new AbortController().signal };
      const d = deferred<Response>();
      collectors.push({ d, call });
      calls.push(call);
      init.signal?.addEventListener?.('abort', () => {
        d.reject(new DOMException('Aborted', 'AbortError'));
      });
      return d.promise;
    }),
  );
}

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  return render(
    <MemoryRouter initialEntries={['/']}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

async function settleLast(body: unknown, status = 200) {
  const entry = collectors[collectors.length - 1];
  if (!entry) throw new Error('no pending fetch to settle');
  await act(async () => {
    entry.d.resolve(jsonResponse(status, body));
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
  });
}

async function typeIn(input: HTMLElement, text: string) {
  await act(async () => {
    fireEvent.change(input, { target: { value: text } });
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  installFetchMock();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('search pipeline', () => {
  it('coalesces fast typing into a single debounced request', async () => {
    renderApp();
    await settleLast(page([asset('a_seed', 'Seed')], 1));

    const input = screen.getByRole('searchbox');
    await typeIn(input, 't');
    await typeIn(input, 'tr');
    await typeIn(input, 'tra');
    await typeIn(input, 'trail');

    // Let the 300 ms debounce fire the one request carrying the final phrase.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    await settleLast(page([asset('a_trail', 'Trail asset')], 1));

    const trailCalls = calls.filter((c) => c.url.includes('q=trail'));
    expect(trailCalls).toHaveLength(1);
    expect(calls.some((c) => c.url.includes('q=tra') && !c.url.includes('q=trail'))).toBe(false);
    expect(screen.getByText('Trail asset')).toBeInTheDocument();
  });

  it('a slow response from an earlier query never overwrites a newer one', async () => {
    renderApp();
    await settleLast(page([asset('a_seed', 'Seed')], 1));

    const input = screen.getByRole('searchbox');

    const startQuery = async (text: string) => {
      await typeIn(input, text);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      const entry = collectors[collectors.length - 1];
      if (!entry) throw new Error('no fetch started');
      return entry;
    };

    // iso's 'tra' query starts (slow on the server) and stays in flight.
    const tra = await startQuery('tra');

    // User finishes the phrase; 'trail' starts and 'tra' is cancelled, not ignored.
    const trail = await startQuery('trail');
    expect(tra.call.signal.aborted, 'earlier in-flight request must be cancelled').toBe(true);

    // Newest response lands first.
    await act(async () => {
      trail.d.resolve(jsonResponse(200, page([asset('a_trail', 'Trail asset')], 1)));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('Trail asset')).toBeInTheDocument();

    // The slow 'tra' response arrives last — it must not change anything.
    await act(async () => {
      tra.d.resolve(jsonResponse(200, page([asset('a_tra', 'Tra asset')], 999)));
      await vi.advanceTimersByTimeAsync(0);
    });
    await Promise.resolve();

    expect(screen.getByText('Trail asset')).toBeInTheDocument();
    expect(screen.queryByText('Tra asset')).not.toBeInTheDocument();
  });

  it('distinguishes a failed view from an empty one and offers recovery', async () => {
    renderApp();
    await settleLast(
      { error: { code: 'upstream_unavailable', message: 'Upstream is down' } },
      503,
    );

    expect(screen.getByText('This view failed to load')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();

    await act(async () => {
      screen.getByRole('button', { name: 'Try again' }).click();
    });
    await settleLast(page([asset('a_retry', 'Recovered asset')], 1));

    expect(screen.getByText('Recovered asset')).toBeInTheDocument();
  });
});