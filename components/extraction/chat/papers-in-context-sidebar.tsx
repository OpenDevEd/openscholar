"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { FileTextIcon, PanelRightOpenIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SourceChip } from "@/components/extraction/bucket/source-chip";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useIsMobile } from "@/lib/hooks";
import { cn } from "@/lib/utils";

interface PapersInContextSidebarProps {
  jobId: Id<"extractionJobs">;
}

type PaperRow = {
  _id: Id<"extractionJobSources">;
  title: string;
  authors: string[];
  year?: number;
  openalexId?: string;
  doi?: string;
  source:
    | "history"
    | "library"
    | "collection"
    | "zotero"
    | "upload";
};

function PaperRow({ row }: { row: PaperRow }) {
  const t = useTranslations("extraction");
  const authorsStr =
    row.authors.length > 0 ? row.authors.join(", ") : t("unknownAuthors");
  return (
    <li
      data-paper-id={row._id}
      data-paper-source={row.source}
      className={cn(
        "group flex flex-col gap-1 rounded-md border border-border/60 bg-card px-3 py-2.5",
        "transition-colors hover:bg-accent/40",
      )}
    >
      <p className="line-clamp-2 text-sm font-medium leading-snug">
        {row.title}
      </p>
      <p className="line-clamp-1 text-xs text-muted-foreground">
        {authorsStr}
      </p>
      <div className="flex items-center justify-between gap-2 pt-1">
        <SourceChip source={row.source} />
        {row.year != null ? (
          <span className="text-[11px] text-muted-foreground">{row.year}</span>
        ) : null}
      </div>
    </li>
  );
}

function PapersContent({ jobId }: { jobId: Id<"extractionJobs"> }) {
  const t = useTranslations("extraction");
  const sources = useQuery(api.extraction.queries.getJobSources, { jobId });

  if (!sources) {
    return (
      <div
        className="flex items-center justify-center p-8 text-sm text-muted-foreground"
        data-sidebar-state="loading"
      >
        {t("chatPreparing")}
      </div>
    );
  }

  if (sources.status !== "ok") {
    return (
      <div
        className="flex items-center justify-center p-8 text-sm text-muted-foreground"
        data-sidebar-state="denied"
      >
        {t("noExtractionJobs")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-sidebar-state="ready">
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <FileTextIcon className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">{t("chatPapersInContext")}</h2>
        </div>
        <span
          className="text-xs text-muted-foreground"
          data-paper-count={sources.sources.length}
        >
          {sources.sources.length}
        </span>
      </header>
      <ScrollArea className="flex-1">
        <ul className="flex flex-col gap-2 p-3">
          {sources.sources.map((row) => (
            <PaperRow
              key={row._id}
              row={{
                _id: row._id,
                title: row.title,
                authors: row.authors,
                year: row.year,
                openalexId: row.openalexId,
                doi: row.doi,
                source: row.source,
              }}
            />
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
}

export function PapersInContextSidebar({ jobId }: PapersInContextSidebarProps) {
  const t = useTranslations("extraction");
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  if (isMobile) {
    return (
      <div className="px-4 pt-3" data-sidebar-variant="mobile">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              aria-label={t("chatPapersInContext")}
              data-sidebar-trigger="mobile"
            >
              <PanelRightOpenIcon className="mr-2 size-4" />
              {t("chatPapersInContext")}
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[85vw] max-w-sm p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>{t("chatPapersInContext")}</SheetTitle>
              <SheetDescription>{t("chatPapersInContext")}</SheetDescription>
            </SheetHeader>
            <PapersContent jobId={jobId} />
          </SheetContent>
        </Sheet>
      </div>
    );
  }

  return (
    <aside
      className="h-full w-[280px] shrink-0 border-r bg-background"
      data-sidebar-variant="desktop"
    >
      <PapersContent jobId={jobId} />
    </aside>
  );
}
