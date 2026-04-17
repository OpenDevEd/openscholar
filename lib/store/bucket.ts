/**
 * Unified paper-selection bucket. Replaces the three legacy draft-job
 * fields (selectedHistoryIds / zoteroSelection / manualItems). Every
 * source tab calls `addMany` with normalised BucketItems, each keyed by
 * its bucketKey so cross-source duplicates collapse automatically.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { BucketItem, BucketItemStatus } from "@/lib/bucket/bucketItem";

type StatusPatch = Partial<
  Pick<BucketItem, "status" | "storageId" | "pdfUrl">
>;

type BucketState = {
  items: Record<string, BucketItem>;
  order: string[];
  addMany: (items: BucketItem[]) => void;
  remove: (bucketKey: string) => void;
  removeMany: (bucketKeys: string[]) => void;
  clear: () => void;
  updateStatus: (bucketKey: string, patch: StatusPatch) => void;
};

function mergeItem(existing: BucketItem, next: BucketItem): BucketItem {
  // Status never regresses from "ready" to "uploading" — once a file has
  // been accepted by the server, a later optimistic re-add from the UI
  // must not flip it back to in-flight.
  const status: BucketItemStatus =
    existing.status === "ready" && next.status === "uploading"
      ? "ready"
      : next.status;
  return { ...existing, ...next, status };
}

export const useBucketStore = create<BucketState>()(
  persist(
    (set) => ({
      items: {},
      order: [],
      addMany: (incoming) =>
        set((state) => {
          if (incoming.length === 0) return state;
          const items = { ...state.items };
          const order = [...state.order];
          for (const item of incoming) {
            const existing = items[item.bucketKey];
            if (existing) {
              items[item.bucketKey] = mergeItem(existing, item);
            } else {
              items[item.bucketKey] = item;
              order.push(item.bucketKey);
            }
          }
          return { items, order };
        }),
      remove: (bucketKey) =>
        set((state) => {
          if (!state.items[bucketKey]) return state;
          const { [bucketKey]: _removed, ...rest } = state.items;
          return {
            items: rest,
            order: state.order.filter((k) => k !== bucketKey),
          };
        }),
      removeMany: (bucketKeys) =>
        set((state) => {
          if (bucketKeys.length === 0) return state;
          const drop = new Set(bucketKeys);
          let changed = false;
          const items: Record<string, BucketItem> = {};
          for (const key of Object.keys(state.items)) {
            if (drop.has(key)) {
              changed = true;
              continue;
            }
            items[key] = state.items[key];
          }
          if (!changed) return state;
          return {
            items,
            order: state.order.filter((k) => !drop.has(k)),
          };
        }),
      clear: () => set({ items: {}, order: [] }),
      updateStatus: (bucketKey, patch) =>
        set((state) => {
          const existing = state.items[bucketKey];
          if (!existing) return state;
          const nextStatus: BucketItemStatus | undefined = patch.status;
          const guardedStatus: BucketItemStatus =
            existing.status === "ready" && nextStatus === "uploading"
              ? "ready"
              : nextStatus ?? existing.status;
          return {
            ...state,
            items: {
              ...state.items,
              [bucketKey]: {
                ...existing,
                ...patch,
                status: guardedStatus,
              },
            },
          };
        }),
    }),
    {
      name: "extraction-bucket",
      version: 1,
      partialize: (state) => ({ items: state.items, order: state.order }),
    },
  ),
);
