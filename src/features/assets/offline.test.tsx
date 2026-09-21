import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from '@/App';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const calls: string[] = [];
const collectors: Array<{ d: ReturnType<typeof deferred<Response>> }> = [];

function asset(id: string, name: string) {
  return {
    id,
    name,
    kind: 'image',
    status: 'draft',
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function installFetchMock() {
  calls.length = 0;
  collectors.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const d = deferred<Response>();
      collectors.push({ d });
      calls.push(url);
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
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: 15_000 },
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

async function settleLast() {
  const entry = collectors[collectors.length - 1];
  if (!entry) throw new Error('no pending fetch');
  await act(async () => {
    entry.d.resolve(jsonResponse(200, { items: [asset('a_seed', 'Seed')], total: 1, nextCursor: null }));
    await vi.advanceTimersByTimeAsync(0);
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
  onlineManager.setOnline(true);
});

afterEach(() => {
  onlineManager.setOnline(true);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('offline resilience', () => {
  it('pauses feed requests while offline and refetches on reconnect', async () => {
    renderApp();
    await settleLast();
    expect(calls.length).toBe(1);

    await act(async () => {
      onlineManager.setOnline(false);
    });
    expect(screen.getByText(/You're offline/)).toBeInTheDocument();

    // A new query while offline must NOT reach the network.
    const input = screen.getByRole('searchbox');
    await typeIn(input, 'trail');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(calls.length).toBe(1);

    // Reconnect clears the banner and fires the deferred query.
    await act(async () => {
      onlineManager.setOnline(true);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByText(/You're offline/)).not.toBeInTheDocument();
    expect(calls.length).toBeGreaterThan(1);

    await settleLast();
    expect(screen.getByText('Seed')).toBeInTheDocument();
  });
});