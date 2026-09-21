import { memo, useState } from 'react';
import { thumbnailUrl } from '@/api/client';
import { formatBytes, formatDate, statusLabel } from '@/lib/format';
import { useAssetUi } from './store';
import type { Asset } from '@/lib/types';

function Thumb({ asset }: { asset: Asset }) {
  const [broken, setBroken] = useState(false);

  if (!asset.hasThumbnail || broken) {
    return <div className="card__thumb card__thumb--missing" role="presentation" aria-hidden="true" />;
  }
  return (
    <img
      className="card__thumb"
      src={thumbnailUrl(asset.id)}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
    />
  );
}

/** Memoised card, per-card store subscription; roving-tabindex (one tab stop), arrows/focus-run selection. */
export const AssetCard = memo(function AssetCard({ asset, lead }: { asset: Asset; lead: boolean }) {
  const selected = useAssetUi((s) => s.selected.has(asset.id));
  const active = useAssetUi((s) => s.activeId === asset.id);
  const toggle = useAssetUi((s) => s.toggle);
  const open = useAssetUi((s) => s.open);
  const setFocus = useAssetUi((s) => s.setFocus);
  // Optimistic status while a bulk write is in flight (undefined once settled).
  const overlayStatus = useAssetUi((s) => s.overlay.get(asset.id));
  const isFocused = useAssetUi((s) => s.focusId === asset.id);
  const anyFocused = useAssetUi((s) => s.focusId !== null);
  const status = overlayStatus ?? asset.status;
  const pending = overlayStatus !== undefined;

  const className =
    'card card--' +
    status +
    (selected ? ' card--selected' : '') +
    (active ? ' card--active' : '') +
    (pending ? ' card--pending' : '') +
    (isFocused ? ' card--focused' : '');

  return (
    <button
      type="button"
      className={className}
      data-asset-id={asset.id}
      tabIndex={isFocused || (!anyFocused && lead) ? 0 : -1}
      onFocus={() => setFocus(asset.id)}
      onClick={() => {
        setFocus(asset.id);
        open(asset.id);
      }}
      aria-pressed={selected}
      aria-label={`${asset.name}, ${statusLabel(status)}${pending ? ', updating' : ''}`}
    >
      <div className="card__img">
        <Thumb asset={asset} />
        <span className="card__kind">{asset.kind}</span>
      </div>
      <div className="card__body">
        <p className="card__name">{asset.name}</p>
        <p className="muted card__meta">
          {asset.kind} · {formatBytes(asset.sizeBytes)} · {formatDate(asset.updatedAt)}
        </p>
        <span className={`pill pill--${status}`}>{statusLabel(status)}</span>
      </div>
      <input
        type="checkbox"
        className="card__check"
        checked={selected}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onChange={() => toggle(asset.id)}
        aria-label={`Select ${asset.name}`}
      />
    </button>
  );
});