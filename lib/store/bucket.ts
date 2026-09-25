/**
 * Unified paper-selection bucket. Replaces the three legacy draft-job
 * fields (selectedHistoryIds / zoteroSelection / manualItems). Every
 * source tab calls `addMany` with normalised BucketItems, each keyed by
 * its bucketKey so cross-source duplicates collapse automatically.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  BucketItem,
  BucketItemStatus,
  BucketSource,
} from "@/lib/bucket/bucketItem";
import { buildDedupeKey } from "@/lib/bucket/dedupe";

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

/**
 * Minimal snapshot of the mutable bucket — `items` map + `order` array.
 * Dedupe maps are recomputed on restore. Captured by the Clear-all
 * path so the Sonner undo toast can round-trip a `clear()`.
 */
export type AllClearSnapshot = {
  items: Record<string, BucketItem>;
  order: string[];
};

type BucketState = {
  items: Record<string, BucketItem>;
  order: string[];
  /**
   * "Weaker" dedupe keys for every staged paper — doi/title+year only,
   * openalexId deliberately stripped. Lets the source tabs show an
   * "also staged from X" hint when the same paper lands under different
   * bucketKeys across sources (e.g. Library stages `openalex:W123` but
   * the same paper in Zotero keys as `doi:10.1/x`). Rebuilt on every
   * mutation; see `computeDedupeMaps`.
   */
  dedupeKeys: Set<string>;
  dedupeKeyToSource: Record<string, BucketSource>;
  addMany: (items: BucketItem[], limit: number) => AddManyResult;
  remove: (bucketKey: string) => void;
  removeMany: (bucketKeys: string[]) => void;
  clear: () => void;
  updateStatus: (bucketKey: string, patch: StatusPatch) => void;
  /**
   * Runtime override for a staged item's `paperCount`. Called by the
   * `<CountChip>` every time the user commits a new value (stepper,
   * preset, blur). `nextCount` is clamped to `[0, cap]` and floored to
   * an integer; a no-op when the clamped value equals the current one
   * or when `bucketKey` is not in the store. The bucket-indicator's
   * `readyCount` selector re-derives from the new `paperCount`, so the
   * invariant "ready weight = sum(paperCount of ready items)" is
   * maintained without a separate stored field.
   */
  updatePaperCount: (
    bucketKey: string,
    nextCount: number,
    cap: number,
  ) => void;
  /**
   * Replace `items` + `order` wholesale with the passed snapshot and
   * recompute dedupe maps. Used by the Clear-all undo toast to reverse
   * a `clear()`. Any rows added between `clear()` and
   * `restoreFromSnapshot(...)` are dropped — restore means "bring back
   * exactly what was there", not "merge".
   */
  restoreFromSnapshot: (snapshot: AllClearSnapshot) => void;
};

/**
 * Returns the weak dedupe key for an item, or `null` if the item
 * shouldn't participate in cross-source matching. Saved-search
 * placeholders (a row standing in for a whole historical search) and
 * items with no identifiers fall into the null bucket.
 */
function weakDedupeKey(item: BucketItem): string | null {
  const meta = item.sourceMeta as
    | { isSavedSearch?: boolean }
    | undefined;
  if (meta?.isSavedSearch) return null;
  try {
    return buildDedupeKey({
      doi: item.doi,
      title: item.title,
      year: item.year,
    });
  } catch {
    return null;
  }
}

function computeDedupeMaps(items: Record<string, BucketItem>): {
  dedupeKeys: Set<string>;
  dedupeKeyToSource: Record<string, BucketSource>;
} {
  const dedupeKeys = new Set<string>();
  const dedupeKeyToSource: Record<string, BucketSource> = {};
  for (const key of Object.keys(items)) {
    const item = items[key];
    const wk = weakDedupeKey(item);
    if (!wk) continue;
    dedupeKeys.add(wk);
    // First write wins. If the user happens to stage the same paper
    // from two sources under different bucketKeys, the hint points to
    // whichever source landed first — stable for the session.
    if (!(wk in dedupeKeyToSource)) {
      dedupeKeyToSource[wk] = item.source;
    }
  }
  return { dedupeKeys, dedupeKeyToSource };
}

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
      dedupeKeys: new Set<string>(),
      dedupeKeyToSource: {},
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
          const derived = computeDedupeMaps(items);
          return { items, order, ...derived };
        });
        return result;
      },
      remove: (bucketKey) =>
        set((state) => {
          if (!state.items[bucketKey]) return state;
          const { [bucketKey]: _removed, ...rest } = state.items;
          const derived = computeDedupeMaps(rest);
          return {
            items: rest,
            order: state.order.filter((k) => k !== bucketKey),
            ...derived,
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
          const derived = computeDedupeMaps(items);
          return {
            items,
            order: state.order.filter((k) => !drop.has(k)),
            ...derived,
          };
        }),
      clear: () =>
        set({
          items: {},
          order: [],
          dedupeKeys: new Set<string>(),
          dedupeKeyToSource: {},
        }),
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
      updatePaperCount: (bucketKey, nextCount, cap) =>
        set((state) => {
          const existing = state.items[bucketKey];
          if (!existing) return state;
          const clamped = Math.max(
            0,
            Math.min(cap, Math.floor(nextCount)),
          );
          if (clamped === (existing.paperCount ?? 0)) return state;
          return {
            ...state,
            items: {
              ...state.items,
              [bucketKey]: { ...existing, paperCount: clamped },
            },
          };
        }),
      restoreFromSnapshot: (snapshot) =>
        set(() => {
          const items = { ...snapshot.items };
          const order = [...snapshot.order];
          return {
            items,
            order,
            ...computeDedupeMaps(items),
          };
        }),
    }),
    {
      name: "extraction-bucket",
      version: 2,
      partialize: (state) => ({ items: state.items, order: state.order }),
      // v2: the server only takes a saved search with its exact OpenAlex
      // request. Older saved searches are dropped; they are added again
      // from search history.
      migrate: (persisted) => {
        const state = persisted as Pick<BucketState, "items" | "order">;
        const items = Object.fromEntries(
          Object.entries(state.items).filter(([, item]) => {
            if (item.source !== "history") return true;
            const filters = (item.sourceMeta as { searchFilters?: object })
              ?.searchFilters;
            return !!filters && "openAlexQuery" in filters;
          }),
        );
        return { items, order: state.order.filter((key) => key in items) };
      },
      // `dedupeKeys` and `dedupeKeyToSource` aren't persisted (Set is not
      // JSON-serialisable and the map is cheap to recompute). Rebuild
      // both from `items` after hydration so selectors see fresh values
      // on first render.
      merge: (persisted, current) => {
        const p = persisted as Partial<BucketState> | undefined;
        const items = p?.items ?? current.items;
        const order = p?.order ?? current.order;
        const derived = computeDedupeMaps(items);
        return {
          ...current,
          items,
          order,
          ...derived,
        };
      },
    },
  ),
);
