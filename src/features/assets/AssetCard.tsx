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
 */
export const AssetCard = memo(function AssetCard({ asset }: { asset: Asset }) {
  const selected = useAssetUi((s) => s.selected.has(asset.id));
  const active = useAssetUi((s) => s.activeId === asset.id);
  const toggle = useAssetUi((s) => s.toggle);
  const open = useAssetUi((s) => s.open);

  const className =
    'card' + (selected ? ' card--selected' : '') + (active ? ' card--active' : '');

  return (
    <button
      type="button"
      className={className}
      onClick={() => open(asset.id)}
      aria-pressed={selected}
      aria-label={`${asset.name}, ${statusLabel(asset.status)}`}
    >
      <Thumb asset={asset} />
      <div className="card__body">
        <p className="card__name">{asset.name}</p>
        <p className="muted card__meta">
          {asset.kind} · {formatBytes(asset.sizeBytes)} · {formatDate(asset.updatedAt)}
        </p>
        <span className={`pill pill--${asset.status}`}>{statusLabel(asset.status)}</span>
      </div>
      <input
        type="checkbox"
        className="card__check"
        checked={selected}
        onClick={(e) => e.stopPropagation()}
        onChange={() => toggle(asset.id)}
        aria-label={`Select ${asset.name}`}
        aria-hidden={selected ? undefined : 'true'}
      />
    </button>
  );
});