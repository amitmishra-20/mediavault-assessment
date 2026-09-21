import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AssetDetail } from '@/features/assets/AssetDetail';
import { AssetFeed } from '@/features/assets/AssetFeed';
import { useAssetFilters } from '@/features/assets/useAssetFilters';
import { useAssetUi } from '@/features/assets/store';
import { applyBulkStatus, patchCacheAsset, type BulkOutcome } from '@/features/assets/bulk';
import { ConnectivityBanner } from '@/lib/connectivity';
import { statusLabel } from '@/lib/format';
import { apiMessage } from '@/lib/errors';
import type { Asset, AssetStatus } from '@/lib/types';

const STATUSES: AssetStatus[] = ['draft', 'in_review', 'approved', 'archived'];
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
  const activeId = useAssetUi((s) => s.activeId);
  const clearSelection = useAssetUi((s) => s.clear);
  const closeDetail = useAssetUi((s) => s.close);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  // Undo remembers the state *before* a bulk write, so it survives that write.
  const undoRef = useRef<UndoState | null>(null);
  const [busy, setBusy] = useState(false);

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

  // When the detail panel closes, hand keyboard focus back to the card that
  // opened it — otherwise the keyboard drops out of the grid entirely.
  const previousActiveRef = useRef<string | null>(activeId);
  useEffect(() => {
    const previous = previousActiveRef.current;
    if (previous !== null && activeId === null) {
      useAssetUi.getState().setFocus(previous);
    }
    previousActiveRef.current = activeId;
  }, [activeId]);

  return (
    <div className="app">
      <header className="topbar">
        <h1>MediaVault</h1>
        <input
          className="search"
          type="search"
          placeholder="Search assets"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label="Search assets"
        />
        <select
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

      <div className="filters">
        {STATUSES.map((s) => (
          <label key={s}>
            <input
              type="checkbox"
              checked={status.includes(s)}
              onChange={() => toggleStatus(s)}
            />
            {statusLabel(s)}
          </label>
        ))}
      </div>

      {selectedCount > 0 && (
        <div className="bulkbar">
          {busy && <span>Applying…</span>}
          <span>
            {selectedCount} selected
          </span>
          {STATUSES.map((s) => (
            <button key={s} onClick={() => applyBulk(s)} disabled={busy}>
              Set {statusLabel(s).toLowerCase()}
            </button>
          ))}
          <button onClick={() => clearSelection()} disabled={busy}>
            Clear selection
          </button>
        </div>
      )}

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

      {/* Screen-reader announcement of selection changes (grid keyboard users). */}
      <p className="sr-only" aria-live="polite">
        {selectedCount > 0 ? `${selectedCount} selected` : 'Selection cleared'}
      </p>

      <main className="content">
        <AssetFeed query={{ q, status, sort }} />
        {activeId && (
          <AssetDetail id={activeId} onClose={closeDetail} onSaved={handleSaved} />
        )}
      </main>
    </div>
  );
}