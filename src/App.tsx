import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AssetDetail } from '@/features/assets/AssetDetail';
import { AssetFeed } from '@/features/assets/AssetFeed';
import { useAssetFilters } from '@/features/assets/useAssetFilters';
import { useAssetFeed } from '@/features/assets/useAssetFeed';
import { useAssetUi } from '@/features/assets/store';
import { applyBulkStatus, patchCacheAsset, type BulkOutcome } from '@/features/assets/bulk';
import { ConnectivityBanner } from '@/lib/connectivity';
import { statusLabel, ASSET_STATUSES } from '@/lib/format';
import { apiMessage } from '@/lib/errors';
import type { Asset, AssetStatus } from '@/lib/types';

// Glyph duplicates the status so selection reads without colour.
const STATUS_GLYPHS: Record<AssetStatus, string> = {
  draft: '○',
  in_review: '◐',
  approved: '✓',
  archived: '▣',
};
const SORTS: Array<{ value: string; label: string }> = [
  { value: 'updatedAt:desc', label: 'Recently updated' },
  { value: 'name:asc', label: 'Name A–Z' },
  { value: 'sizeBytes:desc', label: 'Largest first' },
  { value: 'createdAt:desc', label: 'Newest' },
];

interface UndoState {
  ids: string[];
  previous: Map<string, AssetStatus>;
}

export function App() {
  const queryClient = useQueryClient();
  const { input, setInput, q, status, toggleStatus, sort, setSort } = useAssetFilters();
  const selectedCount = useAssetUi((s) => s.selected.size);
  const [searchOpen, setSearchOpen] = useState(false);
  const activeId = useAssetUi((s) => s.activeId);
  const clearSelection = useAssetUi((s) => s.clear);
  const closeDetail = useAssetUi((s) => s.close);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  // Snapshot taken *before* the write, so Undo survives it.
  const undoRef = useRef<UndoState | null>(null);
  const [busy, setBusy] = useState(false);

  // Stable key so AssetFeed (memo) isn't restarted when the panel opens.
  const feedQuery = useMemo(() => ({ q, status, sort }), [q, status, sort]);
  // Live count sits in the rail; grid re-shares the same cached query.
  const { items, total, isFetching } = useAssetFeed(feedQuery);

  async function runBulk(ids: string[], next: AssetStatus): Promise<BulkOutcome | null> {
    setNotice(null);
    setBusy(true);
    try {
      return await applyBulkStatus(queryClient, ids, next);
    } catch (err) {
      setNotice({ kind: 'error', text: apiMessage(err) });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function applyBulk(next: AssetStatus) {
    const ids = [...useAssetUi.getState().selected];
    if (ids.length === 0 || busy) return;
    const result = await runBulk(ids, next);
    if (!result) return;
    const { appliedIds, failed, previous } = result;
    const text = failed.length === 0
      ? `${appliedIds.length} updated to ${statusLabel(next).toLowerCase()}.`
      : `${appliedIds.length} updated, ${failed.length} failed. ${failed[0]?.code ?? ''}`;
    setNotice({ kind: failed.length > 0 ? 'error' : 'ok', text });
    if (appliedIds.length > 0) undoRef.current = { ids: appliedIds, previous };
    clearSelection();
  }

  async function undoLastBulk() {
    const undo = undoRef.current;
    if (!undo || busy) return;
    undoRef.current = null;
    // One bulk pass per distinct previous status (usually a single group).
    const byStatus = new Map<AssetStatus, string[]>();
    for (const id of undo.ids) {
      const prev = undo.previous.get(id);
      if (prev) {
        const list = byStatus.get(prev) ?? [];
        list.push(id);
        byStatus.set(prev, list);
      }
    }
    let updated = 0;
    let failed = 0;
    for (const [prev, ids] of byStatus) {
      const result = await runBulk(ids, prev);
      if (result) {
        updated += result.appliedIds.length;
        failed += result.failed.length;
      }
    }
    setNotice({
      kind: failed > 0 ? 'error' : 'ok',
      text: `Undo complete: ${updated} restored, ${failed} failed.`,
    });
  }

  function handleSaved(asset: Asset) {
    patchCacheAsset(queryClient, asset);
    setNotice({ kind: 'ok', text: `${asset.name} → ${statusLabel(asset.status)}` });
  }

  // Hand keyboard focus back to the originating card on close.
  const previousActiveRef = useRef<string | null>(activeId);
  useEffect(() => {
    const previous = previousActiveRef.current;
    if (previous !== null && activeId === null) {
      useAssetUi.getState().setFocus(previous);
    }
    previousActiveRef.current = activeId;
  }, [activeId]);

  return (
    <div className={`app${searchOpen ? ' search-open' : ''}`}>
<header className="topbar">
          <span className="brand">
            <svg className="brand__mark" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="1" y="1" width="22" height="22" rx="8" fill="var(--accent)" />
              <path d="M12 6 18 12 12 18 6 12Z" fill="var(--bg)" />
            </svg>
            <span className="brand__name">MediaVault</span>
            <span className="brand__tag">asset library</span>
          </span>
          <div className="search__center">
            <div className="search__wrap">
              <svg className="search__icon" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <input
                className="search"
                type="search"
                placeholder="Search assets"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                aria-label="Search assets"
              />
            </div>
          </div>
          <button
            className="search-toggle"
            onClick={() => setSearchOpen((v) => !v)}
            aria-label={searchOpen ? 'Close search' : 'Search assets'}
            aria-expanded={searchOpen}
          >
            {searchOpen ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            )}
          </button>
          <select
            className="sort sort--desktop"
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            aria-label="Sort order"
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </header>

        
        <div className="rail">
          {selectedCount > 0 ? (
            <div className="bulkbar" role="toolbar" aria-label="Bulk status actions">
              <span className="bulkbar__top">
                {busy && <span className="bulkbar__busy">Applying…</span>}
                <span className="bulkbar__count">{selectedCount} selected</span>
                <span className="bulkbar__sep" aria-hidden="true" />
                <button className="bulkbar__clear" onClick={() => clearSelection()} disabled={busy}>
                  Clear
                </button>
              </span>
              <span className="bulkbar__pills">
                {ASSET_STATUSES.map((s) => (
                  <button key={s} onClick={() => applyBulk(s)} disabled={busy}>
                    {statusLabel(s)}
                  </button>
                ))}
              </span>
            </div>
          ) : (
            <div className="status-tools" role="group" aria-label="Filter by status">
              {ASSET_STATUSES.map((s) => (
                <label key={s} className="filter-chip">
                  <input
                    type="checkbox"
                    checked={status.includes(s)}
                    onChange={() => toggleStatus(s)}
                  />
                  <span className="filter-chip__glyph">{STATUS_GLYPHS[s]}</span>
                  <span>{statusLabel(s)}</span>
                </label>
              ))}
            </div>
          )}
          <p className="feed__caption muted" role="status" aria-live="polite">
            {isFetching && <span className="feed__live"></span>}
            <span className="feed__count"> {items.length}</span>{' '}
            of <span className="feed__count">{total.toLocaleString()}</span> shown
          </p>
          <select
            className="sort sort--mobile"
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            aria-label="Sort order"
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

      {!busy && undoRef.current && (
        <button className="undo" onClick={() => undoLastBulk()} type="button">
          Undo last change
        </button>
      )}

      {notice && (
        <p className={`notice notice--${notice.kind}`} role="status">
          {notice.text}
        </p>
      )}

      <ConnectivityBanner />

      {/* SR announcement for grid-keyboard selection changes. */}
      <p className="sr-only" aria-live="polite">
        {selectedCount > 0 ? `${selectedCount} selected` : 'Selection cleared'}
      </p>

      <main className="content">
        <AssetFeed query={feedQuery} />
        {activeId && (
          <>
            <button
              className="panel__backdrop"
              onClick={closeDetail}
              tabIndex={-1}
              aria-hidden="true"
            />
            <AssetDetail id={activeId} onClose={closeDetail} onSaved={handleSaved} />
          </>
        )}
      </main>
    </div>
  );
}