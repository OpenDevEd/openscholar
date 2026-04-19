"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import {
  FileTextIcon,
  PanelRightClose,
  PanelRightOpenIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { BucketPaperRow } from "@/components/extraction/bucket/bucket-paper-row";
import { PaperSidebarShell } from "@/components/extraction/sidebar/paper-sidebar-shell";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useIsMobile } from "@/lib/hooks";
import {
  useChatPapersSidebarStore,
  getChatPapersSidebarDimensions,
} from "@/lib/store";
import { hoverSpring } from "@/lib/ui/sidebar-motion";

interface PapersInContextSidebarProps {
  jobId: Id<"extractionJobs">;
}

const PANEL_ID = "chat-papers-sidebar-panel";

type JobSourceRow = {
  _id: Id<"extractionJobSources">;
  title: string;
  authors: string[];
  year?: number;
  openalexId?: string;
  doi?: string;
  source: "history" | "library" | "collection" | "zotero" | "upload";
};

function ChatPapersHeader({
  count,
  onCollapse,
  showCollapse,
  title,
}: {
  count: number;
  onCollapse?: () => void;
  showCollapse: boolean;
  title: string;
}) {
  return (
    <header className="flex items-center justify-between gap-2 border-b border-border/50 p-4">
      <div className="flex min-w-0 items-center gap-2">
        <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
        <h2
          id="chat-papers-sidebar-title"
          className="truncate text-sm font-semibold text-foreground"
        >
          {title}
        </h2>
        <span
          className="ml-1 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground tabular-nums"
          data-paper-count={count}
        >
          {count}
        </span>
      </div>
      {showCollapse && onCollapse ? (
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              transition={hoverSpring}
            >
              <Button
                variant="ghost"
                size="icon"
                onClick={onCollapse}
                aria-label="Collapse papers sidebar"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
              >
                <PanelRightClose className="h-4 w-4" />
              </Button>
            </motion.div>
          </TooltipTrigger>
          <TooltipContent side="left">
            Collapse papers (⌘⇧P)
          </TooltipContent>
        </Tooltip>
      ) : null}
    </header>
  );
}

function ChatPapersBody({
  rows,
  emptyLabel,
}: {
  rows: JobSourceRow[];
  emptyLabel: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </p>
    );
  }
  return (
    <ul className="flex w-full flex-col gap-2 p-4">
      <AnimatePresence initial={false}>
        {rows.map((row) => (
          <BucketPaperRow
            key={row._id}
            paper={{
              title: row.title,
              authors: row.authors,
              year: row.year,
              source: row.source,
            }}
            dataAttrs={{ "data-paper-id": row._id }}
          />
        ))}
      </AnimatePresence>
    </ul>
  );
}

function StatusBody({ label, state }: { label: string; state: string }) {
  return (
    <div
      className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground"
      data-sidebar-state={state}
    >
      {label}
    </div>
  );
}

/**
 * Chat-mode "Papers in Context" sidebar. On desktop, mounts the same
 * <PaperSidebarShell> as the bucket so the visual chrome (motion
 * slide, sliver collapse, ⌘⇧P shortcut, hydration gate) is identical
 * — just with no capacity meter, no Clear-all, and no remove buttons
 * (the data is server-persisted at job creation, read-only thereafter).
 *
 * On mobile, falls back to a Sheet drawer triggered by a button — the
 * shell isn't designed to nest inside a sheet, but the same row data
 * renders inside the drawer body using the same header + body components.
 */
export function PapersInContextSidebar({
  jobId,
}: PapersInContextSidebarProps) {
  const t = useTranslations("extraction");
  const isMobile = useIsMobile();
  const hasHydrated = useChatPapersSidebarStore((s) => s._hasHydrated);
  const isCollapsed = useChatPapersSidebarStore((s) => s.isCollapsed);
  const toggle = useChatPapersSidebarStore((s) => s.toggle);
  const [open, setOpen] = useState(false);

  const sources = useQuery(api.extraction.queries.getJobSources, { jobId });
  const title = t("chatPapersInContext");

  // Project the query into header + body. Both desktop shell and mobile
  // sheet consume these so the surface is byte-identical.
  function buildHeader(showCollapse: boolean) {
    const count =
      sources && sources.status === "ok" ? sources.sources.length : 0;
    return (
      <ChatPapersHeader
        count={count}
        showCollapse={showCollapse}
        onCollapse={showCollapse ? toggle : undefined}
        title={title}
      />
    );
  }

  function buildBody() {
    if (!sources) {
      return <StatusBody label={t("chatPreparing")} state="loading" />;
    }
    if (sources.status !== "ok") {
      return <StatusBody label={t("noExtractionJobs")} state="denied" />;
    }
    return (
      <ChatPapersBody
        rows={sources.sources}
        emptyLabel={t("chatPapersInContext")}
      />
    );
  }

  if (isMobile) {
    return (
      <div className="px-4 pt-3" data-sidebar-variant="mobile">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              aria-label={title}
              data-sidebar-trigger="mobile"
            >
              <PanelRightOpenIcon className="mr-2 size-4" />
              {title}
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[85vw] max-w-sm p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>{title}</SheetTitle>
              <SheetDescription>{title}</SheetDescription>
            </SheetHeader>
            <div className="flex h-full flex-col" data-sidebar-state="ready">
              {buildHeader(false)}
              <div className="min-h-0 flex-1 overflow-y-auto">
                {buildBody()}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    );
  }

  const totalCount =
    sources && sources.status === "ok" ? sources.sources.length : 0;
  const { expandedWidth, collapsedWidth } =
    getChatPapersSidebarDimensions(isCollapsed);

  return (
    <PaperSidebarShell
      panelId={PANEL_ID}
      ariaLabel={title}
      hidden={!hasHydrated}
      expandedWidth={expandedWidth}
      collapsedWidth={collapsedWidth}
      collapse={{
        isCollapsed,
        toggle,
        sliverAriaLabel: `Open papers in context — ${totalCount} ${totalCount === 1 ? "paper" : "papers"}`,
        sliverTooltip: "Open papers (⌘⇧P)",
        shortcut: { meta: true, shift: true, key: "p" },
        sliverFooter: (
          <div className="mt-1 flex flex-col items-center gap-1 text-muted-foreground">
            <FileTextIcon className="h-4 w-4" />
            <span className="text-sm font-medium tabular-nums">
              {totalCount}
            </span>
          </div>
        ),
      }}
      header={buildHeader(true)}
      body={buildBody()}
    />
  );
}
