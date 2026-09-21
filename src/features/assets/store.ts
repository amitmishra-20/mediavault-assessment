import { create } from 'zustand';

interface AssetUiState {
  selected: Set<string>;
  activeId: string | null;
  toggle: (id: string) => void;
  clear: () => void;
  selectOnly: (ids: string[]) => void;
  open: (id: string) => void;
  close: () => void;
}

/**
 * Selection and the open card. Kept out of React component state so each card
 * can subscribe to its own membership via an atomic selector:
 * `useAssetUi(s => s.selected.has(id))` — toggling one card re-renders that
 * card (and the bulk bar count), not the other cards in the grid.
 */
export const useAssetUi = create<AssetUiState>((set) => ({
  selected: new Set<string>(),
  activeId: null,
  toggle: (id) =>
    set((s) => {
      const next = new Set(s.selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selected: next };
    }),
  clear: () => set({ selected: new Set<string>() }),
  selectOnly: (ids) => set({ selected: new Set(ids) }),
  open: (id) => set({ activeId: id }),
  close: () => set({ activeId: null }),
}));