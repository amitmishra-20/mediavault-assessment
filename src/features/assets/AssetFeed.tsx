import { memo, useCallback, useEffect, useRef } from 'react';
import { AssetGrid } from './AssetGrid';
import { useAssetUi } from './store';
import { useAssetFeed, type FeedQuery } from './useAssetFeed';

interface Props {
  query: FeedQuery;
}

/** Owns the query and renders one of: loading, error, empty, or the grid. */
export const AssetFeed = memo(function AssetFeed({ query }: Props) {
  const {
    items,
    total,
    errorMessage,
    isPending,
    isError,
    isFetching,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useAssetFeed(query);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Filter change: reset scroll to top and the roving focus cell.
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: 0 });
    useAssetUi.getState().resetNavigation();
  }, [query.q, query.status?.join(','), query.sort]);

  const onNearEnd = useCallback(() => {
    if (hasNextPage && !isFetching) void fetchNextPage();
  }, [hasNextPage, isFetching, fetchNextPage]);

  if (isPending) {
    return (
      <div className="feed">
        <p className="feed__caption muted" role="status">Loading…</p>
        <div className="grid grid--skeleton" aria-hidden="true">
          {Array.from({ length: 12 }, (_, i) => (
            <div className="skeleton skeleton--card" key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (isError && items.length === 0) {
    return (
      <div className="feed">
        <div className="state" role="alert">
          <p className="state__title">This view failed to load</p>
          {errorMessage && <p className="state__detail">{errorMessage}</p>}
          <button onClick={() => void refetch()}>Try again</button>
        </div>
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="feed">
        <div className="state">
          <p className="state__title">No assets match these filters</p>
          <p className="state__detail">Try a different search or widen the status filter.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="feed">
      {isError && (
        <p className="state state--inline" role="alert">
          {errorMessage}{' '}
          <button onClick={() => void refetch()}>Retry</button>
        </p>
      )}
      <AssetGrid assets={items} scrollRef={scrollRef} onNearEnd={onNearEnd} />
      {isFetching && <p className="feed__end muted">Loading more…</p>}
      {!hasNextPage && items.length > 0 && (
        <p className="feed__end muted">End of results</p>
      )}
    </div>
  );
});