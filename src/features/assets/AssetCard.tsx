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

/**
 * One asset card. Subscribes to its own selection + active flags through the
 * store, and is memoised so that appending a page or toggling another card
 * does not re-render it (asset objects are stable references across pages).
 *
 * Keyboard model: the grid is a single-tab-stop (roving tabindex). Exactly one
 * card is `tabindex=0` — the focused one, or the first card while nothing is
 * focused — and every other card is `-1`; arrows steer focus, shift+arrows
 * select runs, Enter/Space open the detail panel.
 */
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
    'card' +
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
      <Thumb asset={asset} />
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
        aria-hidden={selected ? undefined : 'true'}
      />
    </button>
  );
});