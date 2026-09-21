import { create } from 'zustand';
import type { AssetStatus } from '@/lib/types';

interface AssetUiState {
  selected: Set<string>;
  activeId: string | null;
  /** Optimistic status overlay while a bulk write is in flight; rolls back on failure. */
  overlay: Map<string, AssetStatus>;
  /** Roving keyboard focus cell inside the grid (exactly one card is tabbable). */
  focusId: string | null;
  /** Where a shift+arrow selection range started. */
  anchorId: string | null;
  toggle: (id: string) => void;
  clear: () => void;
  open: (id: string) => void;
  close: () => void;
  setFocus: (id: string | null) => void;
  resetNavigation: () => void;
  /** Select every asset from the anchor to `toId` in the given row order. */
  rangeSelect: (anchorId: string, toId: string, orderedIds: string[]) => void;
  setOverlay: (ids: string[], status: AssetStatus) => void;
  clearOverlay: (ids: string[]) => void;
}

/** Selection, open card, optimistic bulk overlay — external store so cards subscribe atomically (no grid re-render). */
export const useAssetUi = create<AssetUiState>((set) => ({
  selected: new Set<string>(),
  activeId: null,
  overlay: new Map<string, AssetStatus>(),
  focusId: null,
  anchorId: null,
  toggle: (id) =>
    set((s) => {
      const next = new Set(s.selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selected: next, anchorId: id };
    }),
  clear: () => set({ selected: new Set<string>(), anchorId: null }),
  open: (id) => set({ activeId: id }),
  close: () => set({ activeId: null }),
  setFocus: (id) => set({ focusId: id }),
  resetNavigation: () => set({ focusId: null, anchorId: null }),
  rangeSelect: (anchorId, toId, orderedIds) =>
    set((s) => {
      const from = orderedIds.indexOf(anchorId);
      const to = orderedIds.indexOf(toId);
      if (from === -1 || to === -1) return s;
      const [lo, hi] = from <= to ? [from, to] : [to, from];
      // Anchor stays fixed until the user toggles, so shift+arrow grows the range.
      return { selected: new Set(orderedIds.slice(lo, hi + 1)) };
    }),
  setOverlay: (ids, status) =>
    set((s) => {
      const next = new Map(s.overlay);
      for (const id of ids) next.set(id, status);
      return { overlay: next };
    }),
  clearOverlay: (ids) =>
    set((s) => {
      const next = new Map(s.overlay);
      for (const id of ids) next.delete(id);
      return { overlay: next };
    }),
}));