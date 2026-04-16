"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { api } from "@/convex/_generated/api";
import { useAddToBasket } from "@/lib/hooks/use-add-to-basket";
import { AddToExtractionButton } from "@/components/extraction/add-to-extraction-button";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { normalizeOpenAlexId } from "@/lib/openalex/normalize";
import { useExtractionBasketStore } from "@/lib/store/extraction-basket";

export function LibraryTab() {
  const t = useTranslations("extraction.selector");
  const { data: items } = useProtectedQuery(
    api.library.queries.listLibrary,
    {
      sortBy: "savedAt",
      sortOrder: "desc",
    },
  );
  const { addToBasket } = useAddToBasket();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const basketPapers = useExtractionBasketStore((s) => s.papers);

  const isLoading = items === undefined;

  const allSelectableIds = useMemo(() => {
    if (!items) return [];
    return items
      .map((item) => normalizeOpenAlexId(item.openalexId))
      .filter((id): id is string => id !== null && !basketPapers.has(id));
  }, [items, basketPapers]);

  const allSelected =
    allSelectableIds.length > 0 &&
    allSelectableIds.every((id) => selected.has(id));

  const handleToggleAll = useCallback(() => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allSelectableIds));
    }
  }, [allSelected, allSelectableIds]);

  const handleToggle = useCallback((normalizedId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(normalizedId)) {
        next.delete(normalizedId);
      } else {
        next.add(normalizedId);
      }
      return next;
    });
  }, []);

  const handleAddSelected = useCallback(() => {
    if (!items || selected.size === 0) return;

    const toAdd = items
      .filter((item) => {
        const normalized = normalizeOpenAlexId(item.openalexId);
        return normalized !== null && selected.has(normalized);
      })
      .map((item) => ({
        rawId: item.openalexId,
        title: item.title,
        doi: item.doi ?? null,
        source: "library" as const,
      }));

    const result = addToBasket(toAdd);
    setSelected(new Set());

    if (result.dropped > 0) {
      toast.info(
        t("addedWithDropped", {
          added: result.added,
          dropped: result.dropped,
        }),
      );
    } else if (result.added > 0) {
      toast.success(t("addedSuccess", { added: result.added }));
    }
  }, [items, selected, addToBasket, t]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2">
        <p className="text-sm font-semibold">
          {t("libraryEmpty.heading")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("libraryEmpty.body")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Bulk actions */}
      <div className="flex items-center gap-3">
        <Checkbox
          checked={allSelected}
          onCheckedChange={handleToggleAll}
          aria-label={t("selectAll")}
        />
        <span className="text-sm text-muted-foreground">
          {t("selectAll")}
        </span>
        {selected.size > 0 && (
          <Button variant="outline" size="sm" onClick={handleAddSelected}>
            {t("addSelected")} ({selected.size})
          </Button>
        )}
      </div>

      {/* Item list */}
      <div className="divide-y">
        {items.map((item) => {
          const normalized = normalizeOpenAlexId(item.openalexId);
          const inBasket = normalized ? basketPapers.has(normalized) : false;
          const isSelected = normalized ? selected.has(normalized) : false;

          return (
            <div
              key={item._id}
              className={`flex items-center gap-3 py-3 ${inBasket ? "opacity-60" : ""}`}
            >
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => normalized && handleToggle(normalized)}
                disabled={inBasket}
                aria-label={item.title}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{item.title}</p>
                {item.doi && (
                  <p className="text-xs text-muted-foreground truncate">
                    {item.doi}
                  </p>
                )}
              </div>
              {inBasket ? (
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {t("alreadyInBasket")}
                </span>
              ) : (
                <AddToExtractionButton
                  paper={{
                    rawId: item.openalexId,
                    title: item.title,
                    doi: item.doi ?? null,
                  }}
                  source="library"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
