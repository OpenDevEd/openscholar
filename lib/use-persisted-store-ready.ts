import { useSyncExternalStore } from "react";

type PersistedStore = {
  // Missing on the server, where a store with browser-only storage gets no persist API.
  persist?: { hasHydrated: () => boolean; onFinishHydration: (listener: () => void) => () => void };
};

const noSubscription = () => () => {};
const notReady = () => false;

/**
 * Whether a store saved in the browser has loaded. False on the server and on
 * the first browser render (so both match), then true: a page shows its
 * loading state instead of flashing an empty list before saved data arrives.
 */
export function usePersistedStoreReady(store: PersistedStore) {
  return useSyncExternalStore(
    store.persist?.onFinishHydration ?? noSubscription,
    store.persist?.hasHydrated ?? notReady,
    notReady,
  );
}
