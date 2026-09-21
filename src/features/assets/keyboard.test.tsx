import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from '@/App';
import { useAssetUi } from './store';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const collectors: Array<{ d: { resolve: (v: Response) => void } }> = [];

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
  collectors.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: RequestInit = {}) => {
      const d = deferred<Response>();
      collectors.push({ d });
      init.signal?.addEventListener?.('abort', () => {
        d.reject(new DOMException('Aborted', 'AbortError'));
      });
      return d.promise;
    }),
  );
}

async function renderFeed(n = 12) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  const view = render(
    <MemoryRouter initialEntries={['/']}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const entry = collectors[collectors.length - 1];
  if (!entry) throw new Error('no initial fetch');
  await act(async () => {
    entry.d.resolve(
      jsonResponse(200, {
        items: Array.from({ length: n }, (_, i) => asset(`a_${i}`, `Asset ${i}`)),
        total: n,
        nextCursor: null,
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
  });
  return view;
}

function cardEl(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-asset-id="${id}"]`);
}

beforeEach(() => {
  vi.useFakeTimers();
  installFetchMock();
  useAssetUi.setState({ selected: new Set(), focusId: null, anchorId: null, activeId: null });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('keyboard grid navigation', () => {
  it('keeps exactly one card in the tab order and moves focus with arrows', async () => {
    await renderFeed();

    expect(document.querySelectorAll('.card[tabindex="0"]')).toHaveLength(1);
    expect(cardEl('a_0')?.tabIndex).toBe(0);

    fireEvent.focus(cardEl('a_0')!);
    fireEvent.keyDown(cardEl('a_0')!, { key: 'ArrowRight' });
    expect(cardEl('a_1')?.tabIndex).toBe(0);

    fireEvent.keyDown(cardEl('a_1')!, { key: 'ArrowDown' });
    expect(cardEl('a_6')?.tabIndex).toBe(0); // cols = 5 in the stubbed 1200px viewport
    expect(document.querySelectorAll('.card[tabindex="0"]')).toHaveLength(1);
  });

  it('extends selection with Shift+Arrow, anchored at the last toggle', async () => {
    await renderFeed();

    // Toggle the middle card — that becomes the range anchor.
    fireEvent.click(cardEl('a_4')?.querySelector('input[type=checkbox]')!);

    fireEvent.focus(cardEl('a_4')!);
    fireEvent.keyDown(cardEl('a_4')!, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(cardEl('a_5')!, { key: 'ArrowRight', shiftKey: true });

    expect([...useAssetUi.getState().selected].sort()).toEqual(['a_4', 'a_5', 'a_6']);
  });

  it('opens the detail panel from the grid and returns focus on Escape', async () => {
    await renderFeed();

    // Button activation (Enter/Space) is browser behaviour; focus the scribe
    // via a click on the grid card, then test our focus-return & Escape flow.
    fireEvent.click(cardEl('a_0')!);

    expect(document.querySelector('.panel')).toBeInTheDocument();
    // Focus entered the panel on open.
    expect(document.activeElement?.textContent).toBe('Close');

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    expect(useAssetUi.getState().activeId).toBeNull();
    expect(useAssetUi.getState().focusId).toBe('a_0');
    expect(cardEl('a_0')).not.toBeNull();
  });

  it('announces the selection through the live region', async () => {
    await renderFeed();

    fireEvent.click(cardEl('a_0')?.querySelector('input[type=checkbox]')!);
    fireEvent.click(cardEl('a_1')?.querySelector('input[type=checkbox]')!);

    const live = document.querySelector('[aria-live="polite"][class="sr-only"]');
    expect(live?.textContent).toBe('2 selected');
  });
});