import { memo, type RefObject, useCallback, useEffect, useMemo, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { AssetCard } from './AssetCard';
import { useAssetUi } from './store';
import type { Asset } from '@/lib/types';

// Keep these four in sync with styles.css (.card sizes). Card height is fixed:
// a fixed-height thumbnail (140px) + a fixed two-line body, so every virtual
// row occupies exactly ROW_HEIGHT and there is never layout shift.
export const CARD_W = 220;
export const GAP = 12;
export const PAD = 16;
export const ROW_HEIGHT = 244;

// Rows of "runway" left below the viewport before the next page loads.
const LOAD_BUFFER = 4 * ROW_HEIGHT;

interface Props {
  assets: Asset[];
  scrollRef: RefObject<HTMLDivElement | null>;
  onNearEnd: () => void;
}

/** Virtualized grid: rows are absolute slices over a full-height spacer; roving-tabindex+shift/arrow navigation. */
export const AssetGrid = memo(function AssetGrid({ assets, scrollRef, onNearEnd }: Props) {
  const [cols, setCols] = useState(4);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      if (width <= 0) return;
      setCols(Math.max(1, Math.floor((width - PAD * 2 + GAP) / (CARD_W + GAP))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollRef]);

  const rows = useMemo(() => {
    const result: Asset[][] = [];
    for (let i = 0; i < assets.length; i += cols) {
      result.push(assets.slice(i, i + cols));
    }
    return result;
  }, [assets, cols]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    gap: GAP,
    overscan: 3,
    getItemKey: (index) => rows[index]?.[0]?.id ?? index,
  });

  const virtualItems = virtualizer.getVirtualItems();

  // Fetch next page only when the viewport nears loaded content's end.
  const atLoadEdge = useCallback(() => {
    const el = scrollRef.current;
    if (!el || rows.length === 0) return false;
    const remaining = virtualizer.getTotalSize() - (el.scrollTop + el.clientHeight);
    return remaining < LOAD_BUFFER;
  }, [virtualizer, scrollRef, rows.length]);

  useEffect(() => {
    if (rows.length > 0 && atLoadEdge()) onNearEnd();
  }, [rows.length, atLoadEdge, onNearEnd]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (atLoadEdge()) onNearEnd();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [atLoadEdge, scrollRef, onNearEnd]);

  // Track store focus imperatively (grid cards own their styling, no re-render).
  useEffect(() => {
    let raf = 0;
    const unsubscribe = useAssetUi.subscribe((state, prev) => {
      if (state.focusId === prev.focusId) return;
      cancelAnimationFrame(raf);
      raf = 0;
      const id = state.focusId;
      if (!id) return;
      const step = () => {
        const el = scrollRef.current?.querySelector<HTMLElement>(`[data-asset-id="${id}"]`);
        if (el) {
          el.focus({ preventScroll: false });
          raf = 0;
          return;
        }
        const index = assets.findIndex((a) => a.id === id);
        if (index === -1) {
          raf = 0;
          return;
        }
        const top = Math.floor(index / cols) * (ROW_HEIGHT + GAP);
        if (scrollRef.current) scrollRef.current.scrollTop = top;
        raf = requestAnimationFrame(step);
      };
      step();
    });
    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
    };
  }, [assets, cols, scrollRef]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const { key, shiftKey, altKey, ctrlKey, metaKey } = event;
    if (altKey || ctrlKey || metaKey) return;
    const { focusId, anchorId, setFocus, rangeSelect } = useAssetUi.getState();
    const idx = focusId ? assets.findIndex((a) => a.id === focusId) : -1;
    if (idx === -1) return;

    let target = idx;
    switch (key) {
      case 'ArrowRight':
        target = idx + 1;
        break;
      case 'ArrowLeft':
        target = idx - 1;
        break;
      case 'ArrowDown':
        target = idx + cols;
        break;
      case 'ArrowUp':
        target = idx - cols;
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = assets.length - 1;
        break;
      default:
        return;
    }
    target = Math.max(0, Math.min(target, assets.length - 1));
    event.preventDefault();

    if (shiftKey && key.startsWith('Arrow')) {
      rangeSelect(anchorId ?? focusId ?? assets[idx]?.id ?? '', assets[target]?.id ?? '', assets.map((a) => a.id));
    }
    setFocus(assets[target]?.id ?? null);
  }

  return (
    <div className="grid" ref={scrollRef as RefObject<HTMLDivElement>} onKeyDown={onKeyDown}>
      <div className="grid__canvas" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualItems.map((item) => {
          const rowAssets = rows[item.index];
          if (!rowAssets) return null;
          return (
            <div
              className="grid__row"
              key={item.key}
              style={{
                transform: `translateY(${item.start}px)`,
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              }}
            >
              {rowAssets.map((asset) => (
                <AssetCard key={asset.id} asset={asset} lead={asset === assets[0]} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
});