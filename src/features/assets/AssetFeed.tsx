import { AssetGrid } from './AssetGrid';
import { useAssetFeed, type FeedQuery } from './useAssetFeed';

interface Props {
  query: FeedQuery;
  selectedIds: Set<string>;
  activeId: string | null;
  onToggleSelect: (id: string) => void;
  onOpen: (id: string) => void;
}

/** Owns the query and renders one of: loading, error, empty, or the grid. */
export function AssetFeed({ query, selectedIds, activeId, onToggleSelect, onOpen }: Props) {
  const { items, total, errorMessage, isPending, isError, isFetching, refetch } = useAssetFeed(query);

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
      <p className="feed__caption muted" role="status" aria-live="polite">
        {items.length} of {total.toLocaleString()} shown
        {isFetching ? ' — searching…' : ''}
      </p>
      {isError && (
        <p className="state state--inline" role="alert">
          {errorMessage} <button onClick={() => void refetch()}>Retry</button>
        </p>
      )}
      <AssetGrid
        assets={items}
        selectedIds={selectedIds}
        activeId={activeId}
        onToggleSelect={onToggleSelect}
        onOpen={onOpen}
      />
      <p className="feed__end muted">{total > items.length ? 'Loading more…' : 'End of results'}</p>
    </div>
  );
}