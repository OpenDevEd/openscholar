"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PanelRightOpenIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { Id } from "@/convex/_generated/dataModel";
import { useIsMobile } from "@/lib/hooks";
import { usePapersContext } from "../papers-context";
import { SourcesPanelInner } from "./sources-panel";

interface SourcesPanelSheetProps {
  jobId: Id<"extractionJobs">;
}

/**
 * Mobile entry point — a Sheet trigger that lives in the chat header.
 * Renders nothing on desktop (the persistent rail handles that surface).
 */
export function SourcesPanelSheet({ jobId }: SourcesPanelSheetProps) {
  const isMobile = useIsMobile();
  const t = useTranslations("sourcesPanel");
  const [open, setOpen] = useState(false);

  const { totalCount: total, includedCount: included } = usePapersContext();

  if (!isMobile) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 text-xs"
          aria-label={t("mobileTrigger", { included, total })}
          data-sources-trigger
        >
          <PanelRightOpenIcon className="size-3.5" />
          <span className="tabular-nums">
            {t("mobileTriggerShort", { included, total })}
          </span>
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-[90vw] max-w-md p-0"
        data-sources-sheet
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription>{t("title")}</SheetDescription>
        </SheetHeader>
        <SourcesPanelInner jobId={jobId} />
      </SheetContent>
    </Sheet>
  );
}
