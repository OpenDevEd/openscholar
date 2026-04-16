"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { useExtractionBasketStore } from "@/lib/store/extraction-basket";
import type { BasketEntry, BasketSource } from "@/lib/store/extraction-basket";
import { BasketSourceSection } from "./basket-source-section";
import { BasketEmptyState } from "./basket-empty-state";
import { ExtractionCounter } from "./extraction-counter";

interface ExtractionBasketDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ExtractionBasketDrawer({
  isOpen,
  onClose,
}: ExtractionBasketDrawerProps) {
  const t = useTranslations("extraction.basket");
  const router = useRouter();
  const hasHydrated = useExtractionBasketStore((s) => s._hasHydrated);
  const papers = useExtractionBasketStore((s) => s.papers);
  const count = useExtractionBasketStore((s) => s.papers.size);
  const remove = useExtractionBasketStore((s) => s.remove);

  const entriesBySource = useMemo(() => {
    const grouped = new Map<BasketSource, BasketEntry[]>();
    for (const entry of papers.values()) {
      const existing = grouped.get(entry.source) ?? [];
      existing.push(entry);
      grouped.set(entry.source, existing);
    }
    return grouped;
  }, [papers]);

  const expandedSources = useMemo(
    () => Array.from(entriesBySource.keys()),
    [entriesBySource],
  );

  const handleRemove = useCallback(
    (id: string) => remove(id),
    [remove],
  );

  const handleCTA = useCallback(() => {
    router.push("/extraction/new");
    onClose();
  }, [router, onClose]);

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent side="right" className="flex flex-col p-0">
        <SheetHeader className="border-b p-4">
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription className="sr-only">
            {t("description", { count })}
          </SheetDescription>
          <ExtractionCounter className="pt-1" />
        </SheetHeader>

        <ScrollArea className="flex-1">
          {!hasHydrated ? null : count === 0 ? (
            <BasketEmptyState />
          ) : (
            <div className="p-4">
              <Accordion type="multiple" defaultValue={expandedSources}>
                {Array.from(entriesBySource.entries()).map(
                  ([source, entries]) => (
                    <BasketSourceSection
                      key={source}
                      source={source}
                      entries={entries}
                      onRemove={handleRemove}
                    />
                  ),
                )}
              </Accordion>
            </div>
          )}
        </ScrollArea>

        <SheetFooter className="border-t p-4">
          <Button
            className="w-full"
            disabled={count === 0}
            onClick={handleCTA}
          >
            {t("cta")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
