import type { QueryClient } from '@tanstack/react-query';
import { bulkSetStatus } from '@/api/client';
import { withRetry } from '@/lib/retry';
import { useAssetUi } from '@/features/assets/store';
import type { Asset, AssetStatus } from '@/lib/types';

// Chunked + pooled: server caps 50/call, rate budget 80 req/10s; per-id outcomes ride the 207 body.
const CHUNK = 50;
const POOL = 3;

export interface BulkOutcome {
  appliedIds: string[];
  failed: Array<{ id: string; code: string }>;
  /** Status of every requested id before the change, for Undo. */
  previous: Map<string, AssetStatus>;
}

function findCacheAsset(queryClient: QueryClient, id: string): Asset | undefined {
  const pages = queryClient
    .getQueryCache()
    .findAll({ queryKey: ['assets'] })
    .flatMap((entry) => (entry.state.data as { pages?: Array<{ items: Asset[] }> } | undefined)?.pages ?? []);
  for (const page of pages) {
    const hit = page.items.find((asset) => asset.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/** Publish the server's authoritative asset into every cached feed page. */
export function patchCacheAsset(queryClient: QueryClient, asset: Asset): void {
  queryClient.setQueriesData({ queryKey: ['assets'] }, (old) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const pages = (old as { pages?: Array<{ items: Asset[] }> } | undefined)?.pages;
    if (!pages) return old;
    return {
      ...(old as object),
      pages: pages.map((page) => ({
        ...page,
        items: page.items.map((a) => (a.id === asset.id ? asset : a)),
      })),
    };
  });
}

async function drainCalls(tasks: Array<() => Promise<void>>, poolSize: number): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (true) {
      const task = tasks[next++];
      if (!task) return;
      await task();
    }
  };
  await Promise.all(Array.from({ length: Math.min(poolSize, tasks.length) }, () => worker()));
}

/** Optimistic bulk status: chunked 207 outcomes, one retry for `conflict`, rollback clears overlay. */
export async function applyBulkStatus(
  queryClient: QueryClient,
  ids: string[],
  status: AssetStatus,
): Promise<BulkOutcome> {
  const previous = new Map<string, AssetStatus>();
  const appliedIds: string[] = [];
  const failed: Array<{ id: string; code: string }> = [];

  for (const id of ids) {
    const known = findCacheAsset(queryClient, id);
    if (known) previous.set(id, known.status);
  }

  useAssetUi.getState().setOverlay(ids, status);

  const writeChunk = async (chunkIds: string[]) => {
    const record = (id: string, code: string) => failed.push({ id, code });

    const result = await withRetry(() => bulkSetStatus(chunkIds, status)).catch(() => null);
    if (!result) {
      for (const id of chunkIds) record(id, 'unavailable');
      return;
    }

    for (const item of result.results) {
      if (item.ok) {
        patchCacheAsset(queryClient, item.asset);
        appliedIds.push(item.id);
        continue;
      }
      if (item.code === 'conflict') {
        const retried = await withRetry(() => bulkSetStatus([item.id], status)).catch(() => null);
        const entry = retried?.results?.[0];
        if (entry?.ok) {
          patchCacheAsset(queryClient, entry.asset);
          appliedIds.push(entry.id);
        } else {
          record(item.id, item.code);
        }
        continue;
      }
      // Permanent — legal_hold/not_found, never retried.
      record(item.id, item.code);
    }
  };

  const tasks: Array<() => Promise<void>> = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    tasks.push(() => writeChunk(part));
  }
  await drainCalls(tasks, POOL);

  // Roll back overlays: cache rewrites successes; failures fall back to old status.
  useAssetUi.getState().clearOverlay(ids);

  return { appliedIds, failed, previous };
}