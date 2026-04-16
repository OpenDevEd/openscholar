/** Zustand persist store for workbench column visibility and active view. Phase 101: WB-02. */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Available workbench view modes.
 */
export type ActiveView = "table" | "card" | "split";

/**
 * Full state shape for the extraction results view store.
 */
interface ExtractionResultsViewState {
  columnVisibility: Record<string, boolean>;
  activeView: ActiveView;
  _hasHydrated: boolean;
  setColumnVisibility: (visibility: Record<string, boolean>) => void;
  toggleColumn: (columnId: string) => void;
  setActiveView: (view: ActiveView) => void;
  setHasHydrated: (hydrated: boolean) => void;
}

/**
 * Migrate persisted view state across versions.
 *
 * Exported separately for unit testability (same pattern as migrateBasketState).
 *
 * @param persistedState - The raw persisted state from storage
 * @param version - The version number of the persisted state
 * @returns Migrated state object
 */
export function migrateViewState(
  persistedState: unknown,
  version: number,
): { columnVisibility: Record<string, boolean>; activeView: ActiveView } {
  if (version < 1) return { columnVisibility: {}, activeView: "table" };
  return persistedState as {
    columnVisibility: Record<string, boolean>;
    activeView: ActiveView;
  };
}

/**
 * Zustand store for extraction results view preferences.
 *
 * Persists columnVisibility and activeView to localStorage.
 * Uses createJSONStorage (no custom adapter needed since all values are plain objects).
 *
 * Column visibility convention: missing key = visible (default true).
 * Explicitly set to false = hidden.
 */
export const useExtractionResultsViewStore =
  create<ExtractionResultsViewState>()(
    persist(
      (set) => ({
        columnVisibility: {},
        activeView: "table" as ActiveView,
        _hasHydrated: false,

        setColumnVisibility: (visibility: Record<string, boolean>) =>
          set({ columnVisibility: visibility }),

        toggleColumn: (columnId: string) =>
          set((state) => ({
            columnVisibility: {
              ...state.columnVisibility,
              [columnId]: !(state.columnVisibility[columnId] ?? true),
            },
          })),

        setActiveView: (view: ActiveView) => set({ activeView: view }),

        setHasHydrated: (hydrated: boolean) =>
          set({ _hasHydrated: hydrated }),
      }),
      {
        name: "extraction-results-view",
        version: 1,
        storage: createJSONStorage(() => localStorage),
        partialize: (state) => ({
          columnVisibility: state.columnVisibility,
          activeView: state.activeView,
        }),
        migrate: migrateViewState,
        onRehydrateStorage: () => (state) => {
          state?.setHasHydrated(true);
        },
      },
    ),
  );
