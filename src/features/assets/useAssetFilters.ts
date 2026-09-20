import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ASSET_STATUSES } from '@/lib/format';
import type { AssetQuery, AssetStatus } from '@/lib/types';

export const SEARCH_DEBOUNCE_MS = 300;

const ALL_SORTS: Array<NonNullable<AssetQuery['sort']>> = [
  'updatedAt:desc',
  'updatedAt:asc',
  'name:asc',
  'name:desc',
  'sizeBytes:desc',
  'createdAt:desc',
];
const DEFAULT_SORT: NonNullable<AssetQuery['sort']> = 'updatedAt:desc';

function parseStatus(raw: string | null): AssetStatus[] {
  if (!raw) return [];
  return raw.split(',').filter((s): s is AssetStatus => (ASSET_STATUSES as string[]).includes(s));
}

function parseSort(raw: string | null): NonNullable<AssetQuery['sort']> {
  return (ALL_SORTS as string[]).includes(raw ?? '') ? (raw as NonNullable<AssetQuery['sort']>) : DEFAULT_SORT;
}

/** Filters live in the URL (shareable); search is debounced, non-typed writes use replace. */
export function useAssetFilters() {
  const [params, setParams] = useSearchParams();

  const qUrl = params.get('q') ?? '';
  const status = parseStatus(params.get('status'));
  const sort = parseSort(params.get('sort'));

  const [input, setInput] = useState(qUrl);
  const [q, setQ] = useState(qUrl);

  // Syncing state from the URL (reload, shared link, back/forward).
  useEffect(() => {
    setInput(qUrl);
    setQ(qUrl);
  }, [qUrl]);

  // Debounce typing into the active query.
  useEffect(() => {
    const timer = setTimeout(() => setQ(input), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  const write = useCallback(
    (patch: Record<string, string | undefined>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(patch)) {
            if (value === undefined || value === '') next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  useEffect(() => {
    if (q !== qUrl) write({ q: q || undefined });
  }, [q, qUrl, write]);

  const toggleStatus = useCallback((s: AssetStatus) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        const current = parseStatus(next.get('status'));
        const updated = current.includes(s)
          ? current.filter((x) => x !== s)
          : [...current, s];
        if (updated.length === 0) next.delete('status');
        else next.set('status', updated.sort().join(','));
        return next;
      },
      { replace: true },
    );
  }, [setParams]);

  const setSort = useCallback(
    (s: NonNullable<AssetQuery['sort']>) => write({ sort: s === DEFAULT_SORT ? undefined : s }),
    [write],
  );

  return { input, setInput, q, status, toggleStatus, sort, setSort };
}