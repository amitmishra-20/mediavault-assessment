import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from '@/App';
import type { Asset } from '@/lib/types';

type Call = { url: string };
const calls: Call[] = [];
const collectors: Array<{ d: { resolve: (v: Response) => void }; call: Call }> = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function asset(id: string, name: string): Asset {
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
    vi.fn((url: string) => {
      const call = { url };
      const d = deferred<Response>();
      collectors.push({ d, call });
      calls.push(call);
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

beforeEach(() => {
  vi.useFakeTimers();
  installFetchMock();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('virtualized grid', () => {
  it('keeps the rendered DOM bounded for a very large result page', async () => {
    renderApp();
    const huge = Array.from({ length: 2000 }, (_, i) => asset(`a_${i}`, `Asset ${i}`));
    await settleLast({ items: huge, total: 2000, nextCursor: null });

    expect((document.body.textContent ?? '').match(/2[,]?000 shown/)).toBeTruthy();

    const renderedCards = document.querySelectorAll('.card').length;
    expect(renderedCards).toBeGreaterThan(0);
    // Only the visible slice (plus overscan) exists — never all 2000.
    expect(renderedCards).toBeLessThan(300);
  });

  it('drops a selection into the shared UI store', async () => {
    renderApp();
    await settleLast({ items: [asset('a_one', 'Only one')], total: 1, nextCursor: null });

    const checkbox = document.querySelector<HTMLInputElement>('.card input[type="checkbox"]');
    expect(checkbox).not.toBeNull();
    await act(async () => {
      fireEvent.click(checkbox!);
    });

    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });
});