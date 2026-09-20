import { useEffect } from 'react';
import { keepPreviousData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { listAssets } from '@/api/client';
import { apiMessage } from '@/lib/errors';
import type { Asset, AssetQuery, AssetStatus } from '@/lib/types';

export const PAGE_SIZE = 24;

export interface FeedQuery {
  q?: string;
  status?: AssetStatus[];
  sort?: NonNullable<AssetQuery['sort']>;
}

/** Infinite query keyed by filters; cursors bound to the key so stale responses can never publish. */
export function useAssetFeed(query: FeedQuery) {
  const queryClient = useQueryClient();
  const queryKey: unknown[] = [
    'assets',
    query.q ?? '',
    query.status?.sort().join(',') ?? '',
    query.sort ?? '',
  ];
  // Stable key identity: abort effect fires on key change only, never re-renders.
  const keyIdentity = JSON.stringify(queryKey);

  useEffect(() => {
    return () => {
      // Abort in-flight fetches for the key being left (late responses can't display, just burn rate budget).
      queryClient.cancelQueries({ queryKey: JSON.parse(keyIdentity) as unknown[] });
    };
  }, [queryClient, keyIdentity]);

  const feed = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam, signal }) =>
      listAssets({ ...query, limit: PAGE_SIZE, cursor: pageParam ?? undefined }, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });

  return {
    ...feed,
    items: feed.data ? feed.data.pages.flatMap((page) => page.items) : ([] as Asset[]),
    total: feed.data?.pages[0]?.total ?? 0,
    errorMessage: feed.error ? apiMessage(feed.error) : null,
  };
}