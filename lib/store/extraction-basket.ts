import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PersistStorage, StorageValue } from "zustand/middleware";

/**
 * Source that added a paper to the extraction basket.
 */
export type BasketSource =
  | "library"
  | "collection"
  | "search"
  | "manual"
  | "zotero";

/**
 * A single paper entry in the extraction basket.
 */
export interface BasketEntry {
  openAlexId: string;
  title: string;
  doi: string | null;
  source: BasketSource;
  addedAt: number;
}

interface PersistedBasketState {
  papers: Map<string, BasketEntry>;
}

/**
 * Full state shape for the extraction basket store.
 */
interface ExtractionBasketState {
  papers: Map<string, BasketEntry>;
  _hasHydrated: boolean;
  add: (input: BasketEntry | BasketEntry[]) => void;
  remove: (id: string) => void;
  has: (id: string) => boolean;
  clear: () => void;
  setHasHydrated: (hydrated: boolean) => void;
}

/**
 * Migrate persisted basket state across versions.
 *
 * Exported separately for unit testability.
 *
 * @param persistedState - The raw persisted state from storage
 * @param version - The version number of the persisted state
 * @returns Migrated state object
 */
export function migrateBasketState(
  persistedState: unknown,
  version: number,
): { papers: Map<string, BasketEntry> } {
  if (version < 1) return { papers: new Map() };
  return persistedState as { papers: Map<string, BasketEntry> };
}

/**
 * Custom PersistStorage adapter that serializes Map to [key, value][]
 * arrays for sessionStorage compatibility.
 *
 * JSON.stringify(new Map()) produces "{}", so we must convert
 * to/from entry arrays manually.
 */
export const basketStorage: PersistStorage<PersistedBasketState> = {
  getItem: (name: string) => {
    const str = sessionStorage.getItem(name);
    if (!str) return null;
    const parsed: StorageValue<{ papers: [string, BasketEntry][] }> =
      JSON.parse(str);
    return {
      ...parsed,
      state: {
        ...parsed.state,
        papers: new Map(parsed.state.papers),
      },
    };
  },
  setItem: (
    name: string,
    value: StorageValue<PersistedBasketState>,
  ) => {
    sessionStorage.setItem(
      name,
      JSON.stringify({
        ...value,
        state: {
          ...value.state,
          papers: Array.from(value.state.papers.entries()),
        },
      }),
    );
  },
  removeItem: (name: string) => sessionStorage.removeItem(name),
};

/**
 * Zustand store for the extraction basket.
 *
 * Persists to sessionStorage with custom Map serialization.
 * Deduplicates by normalized OpenAlex ID (Map key).
 *
 * Count is NOT stored as a separate field -- consumers use the
 * selector `useExtractionBasketStore(s => s.papers.size)`.
 */
export const useExtractionBasketStore = create<ExtractionBasketState>()(
  persist(
    (set, get) => ({
      papers: new Map<string, BasketEntry>(),
      _hasHydrated: false,

      add: (input: BasketEntry | BasketEntry[]) => {
        const entries = Array.isArray(input) ? input : [input];
        set((state) => {
          const next = new Map(state.papers);
          for (const entry of entries) {
            if (!next.has(entry.openAlexId)) {
              next.set(entry.openAlexId, entry);
            }
          }
          return { papers: next };
        });
      },

      remove: (id: string) =>
        set((state) => {
          const next = new Map(state.papers);
          next.delete(id);
          return { papers: next };
        }),

      has: (id: string) => get().papers.has(id),

      clear: () => set({ papers: new Map() }),

      setHasHydrated: (hydrated: boolean) => set({ _hasHydrated: hydrated }),
    }),
    {
      name: "extraction-basket",
      version: 1,
      storage: basketStorage,
      partialize: (state) => ({ papers: state.papers }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
      migrate: migrateBasketState,
    },
  ),
);
