"use client";

import { useMemo, useState } from "react";
import { useConvex } from "convex/react";
// Its unfiled view is a convex-helpers stream, whose pages hold their place only with this hook.
import { usePaginatedQuery } from "convex-helpers/react";
import { motion } from "motion/react";
import {
  Folder,
  Globe,
  Inbox,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
} from "@/components/icons";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
import { PageStepper } from "@/components/shared/page-stepper";
import { SelectableList } from "../selectable-list";
import { useBucketStore } from "@/lib/store/bucket";
import {
  fromCollectionItem,
  fromLibraryItem,
} from "@/lib/bucket/bucketItem";
import type { BucketItem, BucketSource } from "@/lib/bucket/bucketItem";
import { buildDedupeKey } from "@/lib/bucket/dedupe";
import { BUCKET_SOURCE_LABELS } from "@/lib/bucket/source-labels";
import { bucketAdded } from "@/lib/toast/bucket";
import { hoverSpring, sidebarSpring } from "@/lib/ui/sidebar-motion";
import {
  getExtractionSourceSidebarDimensions,
  useExtractionSourceSidebarStore,
} from "@/lib/store";
import { PAPER_LIMIT } from "@/lib/extraction/limits";

type LibItem = Doc<"libraryItems">;
type ViewId = "all" | "unfiled" | Id<"collections">;

/** Collections the sidebar lists at a time. */
const SIDEBAR_PAGE_SIZE = 20;
/** A row and the gap under it, measured: a paged list keeps a full page's height, so the pager stays put. */
const SIDEBAR_ROW_PX = 34;

export function LibraryTab({ paperLimit }: { paperLimit?: number }) {
  const [view, setView] = useState<ViewId>("all");
  const [viewName, setViewName] = useState<string | undefined>(undefined);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState<string | undefined>(undefined);

  const collectionArg: Id<"collections"> | "unfiled" | undefined =
    view === "all" ? undefined : view;
  const activeCollectionId: Id<"collections"> | null =
    view === "all" || view === "unfiled" ? null : view;

  const list = usePaginatedQuery(
    api.extraction.sources.library.list,
    { query, collectionId: collectionArg },
    { initialNumItems: 30 },
  );

  const convex = useConvex();
  const limit = paperLimit ?? PAPER_LIMIT;
  const addMany = useBucketStore((s) => s.addMany);
  const removeMany = useBucketStore((s) => s.removeMany);
  const order = useBucketStore((s) => s.order);
  const bucketKeys = useMemo(() => new Set(order), [order]);
  const dedupeKeys = useBucketStore((s) => s.dedupeKeys);
  const dedupeKeyToSource = useBucketStore((s) => s.dedupeKeyToSource);

  const toBucketItem = (item: LibItem): BucketItem =>
    activeCollectionId
      ? fromCollectionItem(item, activeCollectionId)
      : fromLibraryItem(item);
  const currentSource: BucketSource = activeCollectionId
    ? "collection"
    : "library";

  const alsoStagedFrom = (item: LibItem): BucketSource | null => {
    const bucketKey = toBucketItem(item).bucketKey;
    if (bucketKeys.has(bucketKey)) return null;
    try {
      const weakKey = buildDedupeKey({
        doi: item.doi,
        title: item.title,
        year: item.publicationYear,
      });
      if (!dedupeKeys.has(weakKey)) return null;
      const src = dedupeKeyToSource[weakKey];
      return src && src !== currentSource ? src : null;
    } catch {
      return null;
    }
  };

  const isSelected = useMemo(
    () => (item: LibItem) => bucketKeys.has(toBucketItem(item).bucketKey),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bucketKeys, activeCollectionId],
  );

  const toggle = (item: LibItem, next: boolean) => {
    const bucketItem = toBucketItem(item);
    if (next) bucketAdded(addMany([bucketItem], limit), { silent: true });
    else removeMany([bucketItem.bucketKey]);
  };

  const toggleAll = (next: boolean) => {
    const rows = list.results ?? [];
    const bucketItems = rows.map((r) => toBucketItem(r));
    if (next) bucketAdded(addMany(bucketItems, limit));
    else removeMany(bucketItems.map((b) => b.bucketKey));
  };

  const toggleRange = (rows: LibItem[], next: boolean) => {
    const bucketItems = rows.map((r) => toBucketItem(r));
    if (next) bucketAdded(addMany(bucketItems, limit));
    else removeMany(bucketItems.map((b) => b.bucketKey));
  };

  const selectAllAcross = async () => {
    const res = await convex.query(
      api.extraction.sources.library.listAllIds,
      { query, collectionId: collectionArg },
    );
    const result = addMany(
      res.items.map((r) => toBucketItem(r)),
      limit,
    );
    bucketAdded({ ...result, truncated: res.truncated });
  };

  return (
    <div className="flex gap-4">
      <SourceSidebar
        view={view}
        onChange={(next, name) => {
          setView(next);
          setViewName(name);
          setSearchInput("");
          setQuery(undefined);
        }}
      />
      <section className="min-w-0 flex-1 space-y-4">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(searchInput.trim() || undefined);
          }}
        >
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={searchPlaceholder(view, viewName)}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button type="submit" size="sm" variant="secondary">
            Search
          </Button>
        </form>

        {list.status === "LoadingFirstPage" ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
            <Spinner className="h-4 w-4" aria-label="Loading your library" />
          </div>
        ) : (list.results ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground p-6 text-center border border-border rounded-xl bg-muted/30">
            {emptyMessage(view, query)}
          </p>
        ) : (
          <SelectableList<LibItem>
            items={list.results ?? []}
            keyOf={(item) => item._id}
            isSelected={isSelected}
            onToggle={toggle}
            onToggleRange={toggleRange}
            onToggleAll={toggleAll}
            onSelectAllAcross={selectAllAcross}
            hasMore={list.status === "CanLoadMore"}
            renderRow={(item) => {
              const alsoFrom = alsoStagedFrom(item);
              return (
                <div>
                  <p className="font-medium text-sm truncate">{item.title}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {item.authors ?? "Unknown authors"}
                    {item.publicationYear ? `, ${item.publicationYear}` : ""}
                  </p>
                  {alsoFrom && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Also staged from {BUCKET_SOURCE_LABELS[alsoFrom]}
                    </p>
                  )}
                </div>
              );
            }}
          />
        )}

        {list.status === "CanLoadMore" && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => list.loadMore(30)}
            >
              Load more
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

function searchPlaceholder(view: ViewId, name: string | undefined): string {
  if (view === "all") return "Search your library";
  if (view === "unfiled") return "Search unfiled papers";
  return name ? `Search in ${name}` : "Search this collection";
}

function emptyMessage(view: ViewId, query: string | undefined): string {
  if (query) return "No library items match your search.";
  if (view === "unfiled")
    return "No unfiled papers — every item is in at least one collection.";
  if (view === "all")
    return "Your library is empty. Rate papers from search to save them here.";
  return "This collection is empty.";
}

type SourceSidebarProps = {
  view: ViewId;
  onChange: (v: ViewId, name?: string) => void;
};

function SourceSidebar({ view, onChange }: SourceSidebarProps) {
  const collections = useCursorPage(api.library.collections.listCollections, {}, SIDEBAR_PAGE_SIZE);
  const { data: totalCollections } = useProtectedQuery(api.library.collections.countCollections, {});
  const isCollapsed = useExtractionSourceSidebarStore((s) => s.isCollapsed);
  const hasHydrated = useExtractionSourceSidebarStore((s) => s._hasHydrated);
  const toggle = useExtractionSourceSidebarStore((s) => s.toggle);
  const dims = getExtractionSourceSidebarDimensions(isCollapsed);
  const width = hasHydrated ? dims.currentWidth : dims.expandedWidth;
  const collapsed = hasHydrated && isCollapsed;

  const hasCollections = collections.items.length > 0;

  return (
    <motion.aside
      data-testid="extraction-source-sidebar"
      data-collapsed={collapsed ? "true" : "false"}
      initial={false}
      animate={{ width }}
      transition={sidebarSpring}
      className="shrink-0 overflow-hidden rounded-xl border border-border bg-muted/20"
      style={{ width }}
    >
      <div className={cn("flex items-center gap-1 p-2", collapsed ? "justify-center" : "justify-between")}>
        {!collapsed && (
          <span className="px-1 text-xs font-medium text-muted-foreground">
            Views
          </span>
        )}
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
                onClick={toggle}
                aria-expanded={!collapsed}
                aria-label={collapsed ? "Expand collection sidebar" : "Collapse collection sidebar"}
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
              >
                {collapsed ? (
                  <PanelLeftOpen className="h-4 w-4" />
                ) : (
                  <PanelLeftClose className="h-4 w-4" />
                )}
              </Button>
            </motion.div>
          </TooltipTrigger>
          <TooltipContent side="right">
            {collapsed ? "Expand" : "Collapse"}
          </TooltipContent>
        </Tooltip>
      </div>

      <nav className="flex flex-col gap-0.5 px-2 pb-2" aria-label="Library views">
        <SidebarEntry
          label="All"
          icon={Globe}
          active={view === "all"}
          collapsed={collapsed}
          onClick={() => onChange("all")}
          kind="view"
          viewId="all"
        />
        {hasCollections && (
          <SidebarEntry
            label="Unfiled"
            icon={Inbox}
            active={view === "unfiled"}
            collapsed={collapsed}
            onClick={() => onChange("unfiled")}
            kind="view"
            viewId="unfiled"
          />
        )}
      </nav>

      {hasCollections && (
        <>
          <div className="mx-2 border-t border-border/60" />
          {!collapsed && (
            <div className="px-2 pt-2">
              <span className="px-1 text-xs font-medium text-muted-foreground">
                Collections
              </span>
            </div>
          )}
          <nav
            className={cn("flex flex-col gap-0.5 px-2 py-2", collections.isStale && "pointer-events-none opacity-60")}
            // The padding's 16px plus a full page of rows.
            style={collections.hasPages ? { minHeight: SIDEBAR_PAGE_SIZE * SIDEBAR_ROW_PX - 2 + 16 } : undefined}
            aria-label="Collections"
          >
            {collections.items.map((c) => (
              <SidebarEntry
                key={c._id}
                label={c.name}
                icon={Folder}
                count={c.itemCount}
                active={view === c._id}
                collapsed={collapsed}
                onClick={() => onChange(c._id, c.name)}
                kind="collection"
                viewId={c._id}
              />
            ))}
          </nav>
        </>
      )}

      {!collapsed && collections.hasPages && (
        <PageStepper
          className="px-3 pb-2"
          page={collections.page}
          pageCount={totalCollections === undefined ? undefined : Math.ceil(totalCollections / SIDEBAR_PAGE_SIZE)}
          canPrevious={collections.canPrevious}
          canNext={collections.canNext}
          onPrevious={collections.previous}
          onNext={collections.next}
        />
      )}

      {collections.isLoading && (
        <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
          <Spinner aria-label="Loading collections" className="h-3 w-3" />
        </div>
      )}
    </motion.aside>
  );
}

type SidebarEntryProps = {
  label: string;
  icon: typeof Folder;
  count?: number;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
  kind: "view" | "collection";
  viewId: string;
};

function SidebarEntry({
  label,
  icon: Icon,
  count,
  active,
  collapsed,
  onClick,
  kind,
  viewId,
}: SidebarEntryProps) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      data-view={viewId}
      data-kind={kind}
      data-active={active ? "true" : "false"}
      className={cn(
        "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "hover:bg-muted/50 text-foreground",
        collapsed && "justify-center px-0",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && (
        <>
          <span className="flex-1 truncate">{label}</span>
          {count !== undefined && (
            <span className="text-xs text-muted-foreground">{count}</span>
          )}
        </>
      )}
    </button>
  );
  if (!collapsed) return button;
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">
        {label}
        {count !== undefined ? <span className="ml-2 tabular-nums opacity-70">{count}</span> : null}
      </TooltipContent>
    </Tooltip>
  );
}
