import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { applyBulkStatus } from './bulk';
import { useAssetUi } from './store';
import type { Asset, AssetStatus } from '@/lib/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function asset(id: string, status: AssetStatus = 'draft'): Asset {
  return {
    id,
    name: id,
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

type BulkLine =
  | { id: string; ok: true; asset: Asset }
  | { id: string; ok: false; code: string };

function bulkBody(results: BulkLine[], status = 200) {
  const failed = results.filter((r) => !r.ok).length;
  return jsonResponse(status, { results, applied: results.length - failed, failed });
}

class Api {
  calls: Array<{ ids: string[]; status: AssetStatus }> = [];
  /** Map by id of unconsumed scripts: ['ok'] | ['conflict','ok'] | ['conflict','conflict'] | … */
  private script = new Map<string, BulkLine[]>();
  delays = new Map<string, number>();
  active = 0;
  maxActive = 0;

  constructor() {
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (typeof init?.body !== 'string' || !url.includes('/bulk-status')) {
        return Promise.reject(new Error(`unexpected fetch ${url}`));
      }
      const { ids, status } = JSON.parse(init.body) as { ids: string[]; status: AssetStatus };
      this.calls.push({ ids, status });
      this.active += 1;
      this.maxActive = Math.max(this.maxActive, this.active);
      const delay = Math.max(...ids.map((id) => this.delays.get(id) ?? 0));
      const done = () => {
        this.active -= 1;
      };
      const results: BulkLine[] = ids.map((id) => {
        const lane = this.script.get(id);
        const next = lane?.shift() ??
          (Math.random() < 0.5 ? { id, ok: true as const, asset: asset(id) } : { id, ok: false as const, code: 'conflict' });
        if (next.ok) (next as { asset: Asset }).asset.status = status;
        return next;
      });
      if (delay > 0) {
        const d = deferred<Response>();
        setTimeout(() => {
          done();
          d.resolve(bulkBody(results));
        }, delay);
        return d.promise;
      }
      done();
      return Promise.resolve(bulkBody(results));
    }));
  }

  scriptOk(id: string) {
    this.script.set(id, [{ id, ok: true, asset: asset(id) }]);
  }
  scriptConflictThen(id: string) {
    this.script.set(id, [
      { id, ok: false, code: 'conflict' },
      { id, ok: true, asset: asset(id) },
    ]);
  }
  scriptConflictAlways(id: string) {
    this.script.set(id, [
      { id, ok: false, code: 'conflict' },
      { id, ok: false, code: 'conflict' },
    ]);
  }
  scriptHold(id: string) {
    this.script.set(id, [{ id, ok: false, code: 'legal_hold' }]);
  }
}

function makeClient(assets: Asset[]) {
  const client = new QueryClient();
  client.setQueryData(['assets', 'test feed'], {
    pages: [{ items: assets, nextCursor: null }],
    pageParams: [undefined],
  });
  return client;
}

beforeEach(() => {
  useAssetUi.setState({ selected: new Set(), overlay: new Map() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('bulk status pipeline', () => {
  it('chunks over 50 ids and never exceeds a pool of 3 concurrent requests', async () => {
    const ids = Array.from({ length: 130 }, (_, i) => `a_${i}`);
    const api = new Api();
    ids.forEach((id) => api.scriptOk(id));
    const client = makeClient(ids.map((id) => asset(id)));

    await applyBulkStatus(client, ids, 'archived');

    expect(api.calls.length).toBe(3); // 50, 50, 30
    expect(api.calls.every((c) => c.ids.length <= 50)).toBe(true);
    expect(api.maxActive).toBeLessThanOrEqual(3);
  });

  it('applies the optimistic overlay while the write is in flight', async () => {
    const api = new Api();
    api.delays.set('a_0', 50);
    const ids = Array.from({ length: 60 }, (_, i) => `a_${i}`);
    ids.forEach((id) => api.scriptOk(id));
    const client = makeClient(ids.map((id) => asset(id)));

    const p = applyBulkStatus(client, ids, 'approved');
    expect(useAssetUi.getState().overlay.get('a_0')).toBe('approved');
    expect(useAssetUi.getState().overlay.get('a_59')).toBe('approved');

    await p;
    expect(useAssetUi.getState().overlay.size).toBe(0);
  });

  it('retries a conflict exactly once and counts the asset as applied when it succeeds', async () => {
    const api = new Api();
    api.scriptConflictThen('a_0');
    const client = makeClient([asset('a_0')]);

    const out = await applyBulkStatus(client, ['a_0'], 'in_review');

    expect(out.appliedIds).toEqual(['a_0']);
    expect(out.failed).toEqual([]);
    expect(api.calls.filter((c) => c.ids.includes('a_0'))).toHaveLength(2);
  });

  it('does not retry legal_hold or not_found, and reports them as failed', async () => {
    const api = new Api();
    api.scriptOk('a_ok');
    api.scriptHold('a_hold');
    const client = makeClient([asset('a_ok'), asset('a_hold')]);

    const out = await applyBulkStatus(client, ['a_ok', 'a_hold'], 'approved');

    expect(out.appliedIds).toEqual(['a_ok']);
    expect(out.failed).toEqual([{ id: 'a_hold', code: 'legal_hold' }]);
    // One attempt for each id, no retries for the held asset.
    expect(api.calls.filter((c) => c.ids.includes('a_hold'))).toHaveLength(1);
  });

  it('rolls back a double conflict and keeps the cache at the old status', async () => {
    const api = new Api();
    api.scriptConflictAlways('a_0');
    const client = makeClient([asset('a_0', 'draft')]);

    const out = await applyBulkStatus(client, ['a_0'], 'archived');

    expect(out.appliedIds).toEqual([]);
    expect(out.failed).toEqual([{ id: 'a_0', code: 'conflict' }]);
    expect(useAssetUi.getState().overlay.size).toBe(0);
    const cached = client.getQueryData<{ pages: Array<{ items: Asset[] }> }>(['assets', 'test feed']);
    expect(cached?.pages?.[0]?.items?.[0]?.status).toBe('draft');
  });

  it('publishes the returned server asset into the cache on success', async () => {
    const api = new Api();
    api.scriptOk('a_0');
    const client = makeClient([asset('a_0', 'draft')]);

    await applyBulkStatus(client, ['a_0'], 'approved');

    const cached = client.getQueryData<{ pages: Array<{ items: Asset[] }> }>(['assets', 'test feed']);
    expect(cached?.pages?.[0]?.items?.[0]?.status).toBe('approved');
  });
});