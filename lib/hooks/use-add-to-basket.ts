import { useCallback } from "react";
import { useExtractionBasketStore } from "@/lib/store/extraction-basket";
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
 * Public hook API for the extraction basket.
 *
 * Wraps normalizeOpenAlexId + store actions into a stable interface.
 * Consumed by Phase 102 AddToExtractionButton and Phase 103 selector tabs.
 *
 * @returns Object with addToBasket, removeFromBasket, isInBasket, and basketCount
 */
export function useAddToBasket() {
  const add = useExtractionBasketStore((s) => s.add);
  const remove = useExtractionBasketStore((s) => s.remove);
  const count = useExtractionBasketStore((s) => s.papers.size);

  const addToBasket = useCallback(
    (input: AddToBasketInput | AddToBasketInput[]) => {
      const inputs = Array.isArray(input) ? input : [input];
      const entries: BasketEntry[] = [];
      for (const item of inputs) {
        const normalized = normalizeOpenAlexId(item.rawId);
        if (normalized) {
          entries.push({
            openAlexId: normalized,
            title: item.title,
            doi: item.doi,
            source: item.source,
            addedAt: Date.now(),
          });
        }
      }
      if (entries.length > 0) {
        add(entries);
      }
    },
    [add],
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

  return { addToBasket, removeFromBasket, isInBasket, basketCount: count };
}
