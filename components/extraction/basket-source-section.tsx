"use client";

import { useTranslations } from "next-intl";
import {
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import type { BasketEntry, BasketSource } from "@/lib/store/extraction-basket";
import { BasketPaperRow } from "./basket-paper-row";

interface BasketSourceSectionProps {
  source: BasketSource;
  entries: BasketEntry[];
  onRemove: (id: string) => void;
}

export function BasketSourceSection({
  source,
  entries,
  onRemove,
}: BasketSourceSectionProps) {
  const t = useTranslations("extraction.basket");

  return (
    <AccordionItem value={source}>
      <AccordionTrigger>
        <span>
          {t(`sourceLabel.${source}`)}{" "}
          <span className="text-muted-foreground">({entries.length})</span>
        </span>
      </AccordionTrigger>
      <AccordionContent>
        {entries.map((entry) => (
          <BasketPaperRow
            key={entry.openAlexId}
            entry={entry}
            onRemove={onRemove}
          />
        ))}
      </AccordionContent>
    </AccordionItem>
  );
}
