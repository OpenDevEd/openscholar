"use client";

import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  ArrowUpDown,
  CheckCheck,
  Search,
  SquareMinus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/convex/_generated/api";
import type { ChatSourceRow } from "@/convex/chat/chatPapers";
import type { Id } from "@/convex/_generated/dataModel";
import {
  applyInclusionPatch,
  buildBulkPatch,
} from "@/lib/chat/chat-papers-selection";
import {
  CHAT_SOURCE_COLOR_VAR,
  CHAT_SOURCE_ICON,
} from "@/lib/chat/source-presentation";
import type { ChipCounts, SourceChip } from "@/lib/chat/source-chips";
import type { SortDir, SortField } from "@/lib/chat/sort/source-comparators";
import { cn } from "@/lib/utils";

const SORT_FIELDS: ReadonlyArray<SortField> = [
  "added",
  "title",
  "year",
  "source",
  "inContext",
];

const VISIBLE_CHIPS: ReadonlyArray<SourceChip> = ["all", "openalex", "zotero"];

interface SourcesPanelToolbarProps {
  jobId: Id<"extractionJobs">;
  visibleRows: ChatSourceRow[];
  query: string;
  onQueryChange: (next: string) => void;
  sort: SortField;
  dir: SortDir;
  onSortChange: (next: SortField, nextDir: SortDir) => void;
  chipSelected: SourceChip;
  chipCounts: ChipCounts;
  onChipChange: (next: SourceChip) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

export function SourcesPanelToolbar({
  jobId,
  visibleRows,
  query,
  onQueryChange,
  sort,
  dir,
  onSortChange,
  chipSelected,
  chipCounts,
  onChipChange,
  searchInputRef,
}: SourcesPanelToolbarProps) {
  const t = useTranslations("sourcesPanel");

  const bulkSetChatPapers = useMutation(
    api.chat.chatPapers.bulkSetChatPapers,
  ).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(
      api.chat.chatPapers.listChatSourcesWithInclusion,
      { jobId },
    );
    if (!current) return;
    const patch = buildBulkPatch(current, args.sourceIds, args.included);
    localStore.setQuery(
      api.chat.chatPapers.listChatSourcesWithInclusion,
      { jobId },
      applyInclusionPatch(current, patch),
    );
  });

  function bulkApply(nextIncluded: boolean | "invert") {
    if (nextIncluded === "invert") {
      const wasIncluded = visibleRows
        .filter((r) => r.included)
        .map((r) => r.sourceId);
      const wasExcluded = visibleRows
        .filter((r) => !r.included)
        .map((r) => r.sourceId);
      if (wasIncluded.length) {
        void bulkSetChatPapers({
          jobId,
          sourceIds: wasIncluded,
          included: false,
        });
      }
      if (wasExcluded.length) {
        void bulkSetChatPapers({
          jobId,
          sourceIds: wasExcluded,
          included: true,
        });
      }
      return;
    }
    void bulkSetChatPapers({
      jobId,
      sourceIds: visibleRows.map((r) => r.sourceId),
      included: nextIncluded,
    });
  }

  const disabled = visibleRows.length === 0;

  return (
    <TooltipProvider delayDuration={0}>
      <div
        className="flex flex-col gap-2 border-b border-border/50 px-3 py-2"
        data-sources-panel-toolbar
      >
        <SourceFilterSelect
          selected={chipSelected}
          counts={chipCounts}
          onChange={onChipChange}
        />

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            ref={searchInputRef}
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            data-sources-panel-search
            className="h-8 pl-8 pr-8 text-sm"
          />
          {query.length > 0 && (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              aria-label={t("searchClear")}
              data-sources-panel-search-clear
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <SortMenu sort={sort} dir={dir} onChange={onSortChange} />
          <div className="ml-auto" />
          <div
            role="group"
            aria-label={t("bulk.include")}
            data-bulk-group
            className="flex items-center gap-0.5 rounded-md border border-border/60 bg-background p-0.5"
          >
            <BulkIconButton
              icon={CheckCheck}
              tooltip={t("bulk.include")}
              tone="positive"
              action="include"
              disabled={disabled}
              onClick={() => bulkApply(true)}
            />
            <BulkIconButton
              icon={SquareMinus}
              tooltip={t("bulk.exclude")}
              tone="neutral"
              action="exclude"
              disabled={disabled}
              onClick={() => bulkApply(false)}
            />
            <BulkIconButton
              icon={ArrowLeftRight}
              tooltip={t("bulk.invert")}
              tone="accent"
              action="invert"
              disabled={disabled}
              onClick={() => bulkApply("invert")}
            />
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

function SourceFilterSelect({
  selected,
  counts,
  onChange,
}: {
  selected: SourceChip;
  counts: ChipCounts;
  onChange: (next: SourceChip) => void;
}) {
  const t = useTranslations("sourcesPanel");
  const SelectedIcon = CHAT_SOURCE_ICON[selected];

  return (
    <Select
      value={selected}
      onValueChange={(value) => onChange(value as SourceChip)}
    >
      <SelectTrigger
        size="sm"
        aria-label={t("source.filterLabel")}
        data-sources-filter-trigger
        data-source-selected={selected}
        className="h-8 w-full text-sm"
      >
        <SelectValue placeholder={t("source.placeholder")}>
          <span
            className="flex items-center gap-2"
            data-source-filter-value={selected}
          >
            <SelectedIcon
              className="size-4 shrink-0"
              style={{ color: `var(${CHAT_SOURCE_COLOR_VAR[selected]})` }}
              aria-hidden="true"
            />
            <span className="truncate">{t(`source.${selected}`)}</span>
            <span className="ml-auto pl-2 text-xs tabular-nums text-muted-foreground">
              {counts[selected]}
            </span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" sideOffset={4}>
        {VISIBLE_CHIPS.map((chip) => {
          const ChipIcon = CHAT_SOURCE_ICON[chip];
          const count = counts[chip];
          const disabled = chip !== "all" && count === 0;
          return (
            <SelectItem
              key={chip}
              value={chip}
              disabled={disabled}
              data-source-chip-item={chip}
              data-chip-count={count}
              className="pr-10"
            >
              <span className="flex w-full items-center gap-2">
                <ChipIcon
                  className="size-4 shrink-0"
                  style={{ color: `var(${CHAT_SOURCE_COLOR_VAR[chip]})` }}
                  aria-hidden="true"
                />
                <span className="truncate">{t(`source.${chip}`)}</span>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                  {count}
                </span>
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

function SortMenu({
  sort,
  dir,
  onChange,
}: {
  sort: SortField;
  dir: SortDir;
  onChange: (next: SortField, nextDir: SortDir) => void;
}) {
  const t = useTranslations("sourcesPanel");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          data-sort-trigger
          data-sort-field={sort}
          data-sort-dir={dir}
          className="h-7 gap-1.5 px-2 text-xs"
          aria-label={t("sort.triggerLabel")}
        >
          <ArrowUpDown className="size-3.5 text-muted-foreground" aria-hidden />
          <span className="font-medium">{t(`sort.${sort}`)}</span>
          {dir === "asc" ? (
            <ArrowUp className="size-3 text-muted-foreground" aria-hidden />
          ) : (
            <ArrowDown className="size-3 text-muted-foreground" aria-hidden />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {t("sort.menuLabel")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={sort}
          onValueChange={(value) =>
            onChange(value as SortField, defaultDir(value as SortField))
          }
        >
          {SORT_FIELDS.map((field) => (
            <DropdownMenuRadioItem
              key={field}
              value={field}
              data-sort-field-item={field}
              className="text-sm"
            >
              {t(`sort.${field}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {t("sort.directionLabel")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={dir}
          onValueChange={(value) => onChange(sort, value as SortDir)}
        >
          <DropdownMenuRadioItem
            value="asc"
            data-sort-dir-item="asc"
            className="text-sm"
          >
            <ArrowUp className="size-3.5 text-muted-foreground" />
            {t("sort.asc")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem
            value="desc"
            data-sort-dir-item="desc"
            className="text-sm"
          >
            <ArrowDown className="size-3.5 text-muted-foreground" />
            {t("sort.desc")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BulkIconButton({
  icon: Icon,
  tooltip,
  tone,
  action,
  disabled,
  onClick,
}: {
  icon: typeof CheckCheck;
  tooltip: string;
  tone: "positive" | "neutral" | "accent";
  action: "include" | "exclude" | "invert";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={tooltip}
          data-bulk-action={action}
          data-bulk-tone={tone}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors",
            "hover:bg-muted hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:pointer-events-none disabled:opacity-40",
            tone === "positive" &&
              "data-[bulk-tone=positive]:hover:text-[color:var(--chart-3)]",
            tone === "accent" &&
              "data-[bulk-tone=accent]:hover:text-[color:var(--chart-2)]",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function defaultDir(field: SortField): SortDir {
  if (field === "year" || field === "inContext") return "desc";
  return "asc";
}
