import { useEffect, useRef, useState } from 'react';
import { getAsset, getAssetsByIds, thumbnailUrl, updateAsset } from '@/api/client';
import { formatBytes, formatDate, formatDuration, statusLabel, ASSET_STATUSES } from '@/lib/format';
import { ApiError, apiMessage } from '@/lib/errors';
import { withRetry } from '@/lib/retry';
import type { Asset, AssetStatus } from '@/lib/types';

function isVersionConflict(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'version_conflict';
}

interface Props {
  id: string;
  onClose: () => void;
  onSaved: (asset: Asset) => void;
}

/** Detail panel: loads on open, version-checked saves (never clobbers a newer edit). */
export function AssetDetail({ id, onClose, onSaved }: Props) {
  const [asset, setAsset] = useState<Asset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus into the panel on open (App returns it to the card on close).
  useEffect(() => {
    closeRef.current?.focus();
  }, [id]);

  useEffect(() => {
    setAsset(null);
    setError(null);
    getAsset(id)
      .then(setAsset)
      .catch((err: unknown) => setError(apiMessage(err)));
  }, [id]);

  async function refreshLatest(previousId: string) {
    const { items } = await getAssetsByIds([previousId]);
    const latest = items[0];
    if (latest) {
      setAsset(latest);
      onSaved(latest);
    }
  }

  async function setStatus(status: AssetStatus) {
    if (!asset) return;
    setSaving(true);
    setError(null);
    try {
      // Retry-safe: 500 write_failed + network failures; never 409/400.
      const updated = await withRetry(() => updateAsset(asset.id, asset.version, { status }));
      setAsset(updated);
      onSaved(updated);
    } catch (err) {
      if (isVersionConflict(err)) {
        // Stale copy: adopt the latest server state.
        setError('This asset was changed elsewhere. Reloading the latest version.');
        await refreshLatest(asset.id);
      } else {
        setError(apiMessage(err));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside
      className="panel"
      role="dialog"
      aria-label="Asset detail"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="panel__head">
        <h2>Asset detail</h2>
        <button ref={closeRef} onClick={onClose}>Close</button>
      </div>

      {error && <p className="error">{error}</p>}
      {!asset && !error && <p className="muted">Loading…</p>}

      {asset && (
        <div className="panel__body">
          <img className="panel__thumb" src={thumbnailUrl(asset.id)} alt="" />
          <h3>{asset.name}</h3>
          <dl className="facts">
            <dt>Id</dt>
            <dd>{asset.id}</dd>
            <dt>Kind</dt>
            <dd>{asset.kind}</dd>
            <dt>Size</dt>
            <dd>{formatBytes(asset.sizeBytes)}</dd>
            {asset.width && (
              <>
                <dt>Dimensions</dt>
                <dd>
                  {asset.width}×{asset.height}
                </dd>
              </>
            )}
            {asset.durationSec && (
              <>
                <dt>Duration</dt>
                <dd>{formatDuration(asset.durationSec)}</dd>
              </>
            )}
            <dt>Owner</dt>
            <dd>{asset.owner.name}</dd>
            <dt>Updated</dt>
            <dd>{formatDate(asset.updatedAt)}</dd>
            <dt>Version</dt>
            <dd>{asset.version}</dd>
          </dl>

          {asset.tags.length > 0 && (
            <ul className="tags">
              {asset.tags.map((tag) => (
                <li key={tag}>{tag}</li>
              ))}
            </ul>
          )}

          <p className="muted panel__label">Status</p>
          <div className="seg">
            {ASSET_STATUSES.map((status) => (
              <button
                key={status}
                disabled={saving || status === asset.status}
                onClick={() => setStatus(status)}
              >
                {statusLabel(status)}
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
