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

/**
 * Outcome of a batched stage. `added` is new rows that landed in the
 * bucket; `deduped` is collisions on `bucketKey` with an existing row;
 * `capped` is new ready-items dropped because they would push ready
 * count past the per-user paper limit. Callers feed this into the
 * `bucketAdded` toast helper (see `lib/toast/bucket.ts`).
 */
export type AddManyResult = {
  added: number;
  deduped: number;
  capped: number;
};

type BucketState = {
  items: Record<string, BucketItem>;
  order: string[];
  addMany: (items: BucketItem[], limit: number) => AddManyResult;
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
      addMany: (incoming, limit) => {
        if (incoming.length === 0) {
          return { added: 0, deduped: 0, capped: 0 };
        }
        // Compute inside the set closure; Zustand runs it synchronously,
        // so the outer `result` is populated before addMany returns.
        let result: AddManyResult = { added: 0, deduped: 0, capped: 0 };
        set((state) => {
          const items = { ...state.items };
          const order = [...state.order];
          // `paperCount` drives cap math: a saved-search entry carries
          // its expansion size here so three 800-paper searches hit the
          // cap at selection time, not at submit time. Per-paper
          // sources default to 1.
          const papersOf = (item: BucketItem | undefined) =>
            item?.status === "ready" ? item.paperCount ?? 1 : 0;
          const currentReady = order.reduce(
            (n, k) => n + papersOf(items[k]),
            0,
          );
          let readySlotsLeft = Math.max(0, limit - currentReady);
          let added = 0;
          let deduped = 0;
          let capped = 0;
          for (const item of incoming) {
            const existing = items[item.bucketKey];
            if (existing) {
              items[item.bucketKey] = mergeItem(existing, item);
              deduped++;
              continue;
            }
            const papers = item.status === "ready" ? item.paperCount ?? 1 : 0;
            if (papers > readySlotsLeft) {
              capped++;
              continue;
            }
            items[item.bucketKey] = item;
            order.push(item.bucketKey);
            readySlotsLeft -= papers;
            added++;
          }
          result = { added, deduped, capped };
          return { items, order };
        });
        return result;
      },
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
