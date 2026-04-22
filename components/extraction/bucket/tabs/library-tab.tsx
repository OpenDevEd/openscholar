"use client";

import { useMemo, useState } from "react";
import { useConvex, usePaginatedQuery, useQuery } from "convex/react";
import { motion } from "motion/react";
import {
  Folder,
  Globe,
  Inbox,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
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

type LibItem = Doc<"libraryItems">;
type ViewId = "all" | "unfiled" | Id<"collections">;

type CollectionRow = Doc<"collections"> & { itemCount: number };

export function LibraryTab({ paperLimit }: { paperLimit?: number }) {
  const collections = useQuery(
    api.library.collections.getCollectionsWithCounts,
    {},
  );
  const [view, setView] = useState<ViewId>("all");
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
  const liveLimit = useQuery(
    api.extraction.bucket.queries.getMyPaperLimit,
    paperLimit === undefined ? {} : "skip",
  );
  const limit = paperLimit ?? liveLimit ?? 1000;
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
        collections={collections}
        view={view}
        onChange={(next) => {
          setView(next);
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
              placeholder={searchPlaceholder(view, collections)}
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
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your library…
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
                    {item.publicationYear ? ` · ${item.publicationYear}` : ""}
                  </p>
                  {alsoFrom && (
                    <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground/80">
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

function searchPlaceholder(
  view: ViewId,
  collections: CollectionRow[] | undefined,
): string {
  if (view === "all") return "Search your library";
  if (view === "unfiled") return "Search unfiled papers";
  const name = collections?.find((c) => c._id === view)?.name;
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
  collections: CollectionRow[] | undefined;
  view: ViewId;
  onChange: (v: ViewId) => void;
};

function SourceSidebar({ collections, view, onChange }: SourceSidebarProps) {
  const isCollapsed = useExtractionSourceSidebarStore((s) => s.isCollapsed);
  const hasHydrated = useExtractionSourceSidebarStore((s) => s._hasHydrated);
  const toggle = useExtractionSourceSidebarStore((s) => s.toggle);
  const dims = getExtractionSourceSidebarDimensions(isCollapsed);
  const width = hasHydrated ? dims.currentWidth : dims.expandedWidth;
  const collapsed = hasHydrated && isCollapsed;

  const hasCollections = (collections?.length ?? 0) > 0;

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
          <span className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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
              <span className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Collections
              </span>
            </div>
          )}
          <nav className="flex flex-col gap-0.5 px-2 py-2" aria-label="Collections">
            {collections!.map((c) => (
              <SidebarEntry
                key={c._id}
                label={c.name}
                icon={Folder}
                count={c.itemCount}
                active={view === c._id}
                collapsed={collapsed}
                onClick={() => onChange(c._id)}
                kind="collection"
                viewId={c._id}
              />
            ))}
          </nav>
        </>
      )}

      {collections === undefined && (
        <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          {!collapsed && <span>Loading…</span>}
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
        {count !== undefined ? ` · ${count}` : ""}
      </TooltipContent>
    </Tooltip>
  );
}
