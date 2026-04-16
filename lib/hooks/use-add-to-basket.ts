import { useCallback } from "react";
import { useExtractionBasketStore } from "@/lib/store/extraction-basket";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { api } from "@/convex/_generated/api";
import { normalizeOpenAlexId } from "@/lib/openalex/normalize";
import type { BasketEntry, BasketSource } from "@/lib/store/extraction-basket";

/**
 * Input shape for adding papers to the extraction basket.
 * Uses rawId (any OpenAlex ID format) which gets normalized internally.
 */
export interface AddToBasketInput {
  rawId: string;
  title: string;
  doi: string | null;
  source: BasketSource;
}

/**
 * Result of a cap-aware addToBasket call.
 */
export interface AddToBasketResult {
  added: number;
  dropped: number;
}

/**
 * Pure function for cap-aware batch truncation.
 *
 * Reads store state synchronously via getState() to avoid reactive re-renders.
 * Normalizes IDs, deduplicates against current basket, and truncates to remaining capacity.
 *
 * Invalid IDs (normalizeOpenAlexId returns null) and duplicates (already in basket)
 * are silently filtered -- they are NOT counted as "dropped".
 * Only valid, non-duplicate inputs that exceed capacity are "dropped".
 *
 * @param inputs - Raw inputs to add
 * @param limit - Maximum basket capacity
 * @returns Object with entries to add, and added/dropped counts
 */
export function computeCapAwareBatch(
  inputs: AddToBasketInput[],
  limit: number,
): AddToBasketResult & { entries: BasketEntry[] } {
  const store = useExtractionBasketStore.getState();
  const currentSize = store.papers.size;
  const remaining = Math.max(0, limit - currentSize);

  const entries: BasketEntry[] = [];
  let validNewCount = 0;

  for (const item of inputs) {
    const normalized = normalizeOpenAlexId(item.rawId);
    // Skip invalid IDs silently
    if (!normalized) continue;
    // Skip duplicates silently (not counted as dropped)
    if (store.has(normalized)) continue;

    validNewCount++;

    // Only collect entries that fit within remaining capacity
    if (entries.length < remaining) {
      entries.push({
        openAlexId: normalized,
        title: item.title,
        doi: item.doi,
        source: item.source,
        addedAt: Date.now(),
      });
    }
  }

  return {
    added: entries.length,
    dropped: Math.max(0, validNewCount - entries.length),
    entries,
  };
}

/**
 * Public hook API for the extraction basket.
 *
 * Wraps normalizeOpenAlexId + store actions into a stable interface.
 * Cap-aware: addToBasket returns { added, dropped } when batch exceeds limit.
 * Consumed by Phase 102 AddToExtractionButton and Phase 103 selector tabs.
 *
 * @returns Object with addToBasket, removeFromBasket, isInBasket, basketCount, and limit
 */
export function useAddToBasket() {
  const add = useExtractionBasketStore((s) => s.add);
  const remove = useExtractionBasketStore((s) => s.remove);
  const count = useExtractionBasketStore((s) => s.papers.size);
  const limitData = useProtectedQuery(
    api.extraction.queries.getExtractionLimit,
    {},
  );
  const limit = limitData.data?.limit ?? 1000;

  const addToBasket = useCallback(
    (input: AddToBasketInput | AddToBasketInput[]): AddToBasketResult => {
      const inputs = Array.isArray(input) ? input : [input];
      const { added, dropped, entries } = computeCapAwareBatch(inputs, limit);

      if (entries.length > 0) {
        add(entries);
      }

      return { added, dropped };
    },
    [add, limit],
  );

  const removeFromBasket = useCallback(
    (rawId: string) => {
      const normalized = normalizeOpenAlexId(rawId);
      if (normalized) remove(normalized);
    },
    [remove],
  );

  const isInBasket = useCallback((rawId: string) => {
    const normalized = normalizeOpenAlexId(rawId);
    if (!normalized) return false;
    return useExtractionBasketStore.getState().has(normalized);
  }, []);

  return { addToBasket, removeFromBasket, isInBasket, basketCount: count, limit };
}
