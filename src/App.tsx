import { useState } from 'react';
import { bulkSetStatus } from '@/api/client';
import { AssetDetail } from '@/features/assets/AssetDetail';
import { AssetFeed } from '@/features/assets/AssetFeed';
import { useAssetFilters } from '@/features/assets/useAssetFilters';
import { useAssetUi } from '@/features/assets/store';
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

export function App() {
  const { input, setInput, q, status, toggleStatus, sort, setSort } = useAssetFilters();
  const selectedCount = useAssetUi((s) => s.selected.size);
  const activeId = useAssetUi((s) => s.activeId);
  const clearSelection = useAssetUi((s) => s.clear);
  const closeDetail = useAssetUi((s) => s.close);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function applyBulkStatus(next: AssetStatus) {
    const ids = [...useAssetUi.getState().selected];
    if (ids.length === 0) return;
    setNotice(null);
    try {
      const result = await bulkSetStatus(ids, next);
      setNotice({
        kind: result.failed > 0 ? 'error' : 'ok',
        text: `${result.applied} updated, ${result.failed} failed.`,
      });
      clearSelection();
    } catch (err) {
      setNotice({ kind: 'error', text: apiMessage(err) });
    }
  }

  function handleSaved(asset: Asset) {
    setNotice({ kind: 'ok', text: `${asset.name} → ${statusLabel(asset.status)}` });
  }

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
          <span>{selectedCount} selected</span>
          {STATUSES.map((s) => (
            <button key={s} onClick={() => applyBulkStatus(s)}>
              Set {statusLabel(s).toLowerCase()}
            </button>
          ))}
          <button onClick={() => clearSelection()}>Clear selection</button>
        </div>
      )}

      {notice && (
        <p className={`notice notice--${notice.kind}`} role="status">
          {notice.text}
        </p>
      )}

      <main className="content">
        <AssetFeed query={{ q, status, sort }} />
        {activeId && (
          <AssetDetail id={activeId} onClose={closeDetail} onSaved={handleSaved} />
        )}
      </main>
    </div>
  );
}