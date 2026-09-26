import { useSyncExternalStore } from "react";

type PersistedStore = {
  persist: { hasHydrated: () => boolean; onFinishHydration: (listener: () => void) => () => void };
};

/**
 * Whether a store saved in the browser has loaded. False on the server and on
 * the first browser render (so both match), then true: a page shows its
 * loading state instead of flashing an empty list before saved data arrives.
 */
export function usePersistedStoreReady(store: PersistedStore) {
  return useSyncExternalStore(store.persist.onFinishHydration, store.persist.hasHydrated, () => false);
}
