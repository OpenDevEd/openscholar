"use client";

import { useDeferredValue, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Filter,
  Globe2,
  History,
  LockOpen,
  Pencil,
  RotateCcw,
  Save,
  Shapes,
  X,
} from "lucide-react";
import {
  searchOpenAlexTopicOptions,
} from "@/app/actions/openalex-topic-options";
import { HistoryCommandCenter } from "@/components/history-command-center";
import { ResultsList } from "@/components/results-list";
import { SidebarContent } from "@/components/search-sidebar";
import { FilterCountControl } from "@/components/shared/filter-count-control";
import { FilterSection } from "@/components/shared/filter-section";
import { SegmentedToggle } from "@/components/shared/segmented-toggle";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  EMPTY_IMPORT_EXTRAS,
  importExtraApiFilters,
  type OpenAlexImportExtras,
} from "@/lib/evidence-libraries/openalex-import-request";
import { countActiveFilters } from "@/lib/filters";
import { sidebarSpring } from "@/lib/ui/sidebar-motion";
import { DEFAULT_SEARCH_PARAMS, SearchProvider, useSearch } from "@/lib/search";
import useSWR from "swr";
import { useIsTablet } from "@/lib/hooks";
import { buildResultsUrl, paramsToSearchResult, searchResultToParams } from "@/lib/search-params";
import { useSearchHistoryStore } from "@/lib/store";
import { approveOpenAlexQuery, type OpenAlexSourceEntry } from "@/lib/evidence-libraries/configuration/sources";
import { buildOpenAlexSourceQuery, readOpenAlexSourceSearch, sameOpenAlexSourceSearch } from "@/lib/evidence-libraries/openalex-source-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useSourceTopicNames } from "./use-source-topic-names";
import type { SearchField } from "@/lib/types";
import {
  cn,
  DEFAULT_FILTERS,
  isCitedByFilterActive,
  isCitesFilterActive,
  isRelatedToFilterActive,
} from "@/lib/utils";
import {
  SDGS,
  TOPIC_LEVELS,
  type ImportQuery,
} from "./openalex-import-model";

type Choice = { id: string; name: string; hint?: string };

function OptionPicker({
  label,
  placeholder,
  options,
  selected,
  names,
  loading,
  error,
  onSearch,
  onToggle,
}: {
  label: string;
  placeholder: string;
  options: readonly Choice[];
  selected: string[];
  names: Record<string, string>;
  loading?: boolean;
  error?: boolean;
  onSearch?: (value: string) => void;
  onToggle: (option: Choice) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={label}
            className="h-9 w-full justify-between font-normal"
          >
            <span
              className={cn(
                "truncate",
                selected.length === 0 && "text-muted-foreground",
              )}
            >
              {selected.length === 0
                ? placeholder
                : `${selected.length} selected`}
            </span>
            <ChevronDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[--radix-popover-trigger-width] min-w-72 p-0"
          align="start"
        >
          <Command shouldFilter={!onSearch}>
            <CommandInput
              placeholder={`Search ${label.toLowerCase()}`}
              onValueChange={onSearch}
            />
            <CommandList>
              <CommandEmpty>
                {loading
                  ? "Searching"
                  : error
                    ? "Could not load research areas. Try another search."
                    : "Nothing found"}
              </CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.id}
                    value={`${option.name} ${option.id}`}
                    onSelect={() => onToggle(option)}
                  >
                    <Check
                      className={cn(
                        "size-4",
                        selected.includes(option.id)
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {option.name}
                    </span>
                    {option.hint ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {option.hint}
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selected.length ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((id) => (
            <span
              key={id}
              className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs"
            >
              <span className="truncate">{names[id] ?? id}</span>
              <button
                type="button"
                aria-label={`Remove ${names[id] ?? id}`}
                className="rounded-sm text-muted-foreground hover:text-foreground"
                onClick={() => onToggle({ id, name: names[id] ?? id })}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Research areas, goals and open access, in the sidebar's own cards. */
function ImportOnlyFilters({
  extras,
  setExtras,
  topicNames,
  setTopicNames,
}: {
  extras: OpenAlexImportExtras;
  setExtras: (change: Partial<OpenAlexImportExtras>) => void;
  topicNames: Record<string, string>;
  setTopicNames: (update: (value: Record<string, string>) => Record<string, string>) => void;
}) {
  const [topicSearch, setTopicSearch] = useState("");
  const deferredSearch = useDeferredValue(topicSearch);
  const topics = useSWR(
    ["source-research-areas", extras.topicLevel, deferredSearch],
    ([, level, search]) => searchOpenAlexTopicOptions(level, search),
    { revalidateOnFocus: false },
  );
  const topicOptions = topics.data ?? [];
  const savedNames = useSourceTopicNames(extras.topicLevel, extras.topicIds);

  return (
    <>
      {Object.keys(extras.additionalFilters ?? {}).length > 0 && (
        <FilterSection title="Other source filters" icon={Filter} isActive onClear={() => setExtras({additionalFilters: {}})}>
          {Object.entries(extras.additionalFilters ?? {}).map(([key, value]) => (
            <div key={key} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 break-words">{key.replaceAll("_", " ")} {value}</span>
              <Button variant="ghost" size="icon" aria-label={`Remove ${key}`} onClick={() => {
                const remaining = {...extras.additionalFilters};
                delete remaining[key];
                setExtras({additionalFilters: remaining});
              }}><X className="size-3" /></Button>
            </div>
          ))}
        </FilterSection>
      )}
      <FilterSection
        title="Research areas"
        icon={Shapes}
        isActive={extras.topicIds.length > 0}
        onClear={() => setExtras({ topicIds: [] })}
      >
        <div className="space-y-2">
          <SegmentedToggle
            ariaLabel="Level of research area"
            value={extras.topicLevel}
            options={TOPIC_LEVELS}
            onChange={(level) => {
              setExtras({ topicLevel: level, topicIds: [] });
              setTopicSearch("");
            }}
          />
          <div>
            <OptionPicker
              label="Research areas"
              placeholder="Any research area"
              options={topicOptions.map((option) => ({ id: option.id, name: option.name, hint: option.within }))}
              selected={extras.topicIds}
              names={{ ...savedNames, ...topicNames }}
              loading={topics.isLoading}
              error={Boolean(topics.error)}
              onSearch={setTopicSearch}
              onToggle={(option) => {
                setTopicNames((value) => ({ ...value, [option.id]: option.name }));
                setExtras({
                  topicIds: extras.topicIds.includes(option.id)
                    ? extras.topicIds.filter((id) => id !== option.id)
                    : [...extras.topicIds, option.id],
                });
              }}
            />
          </div>
        </div>
      </FilterSection>
      <FilterSection
        title="SDGs"
        icon={Globe2}
        isActive={extras.sdgs.length > 0}
        onClear={() => setExtras({ sdgs: [] })}
      >
        <OptionPicker
          label="SDGs"
          placeholder="Any SDG"
          options={SDGS}
          selected={extras.sdgs}
          names={Object.fromEntries(SDGS.map((goal) => [goal.id, goal.name]))}
          onToggle={(option) =>
            setExtras({
              sdgs: extras.sdgs.includes(option.id)
                ? extras.sdgs.filter((id) => id !== option.id)
                : [...extras.sdgs, option.id],
            })
          }
        />
      </FilterSection>
      <FilterSection
        title="Open access"
        icon={LockOpen}
        isActive={extras.openAccessOnly}
        onClear={() => setExtras({ openAccessOnly: false })}
      >
        <label className="flex items-center justify-between gap-3">
          <span className="space-y-0.5">
            <span className="block text-sm font-medium">Only open access</span>
            <span className="block text-xs text-muted-foreground">Skip records readers cannot open for free</span>
          </span>
          <Switch
            checked={extras.openAccessOnly}
            onCheckedChange={(openAccessOnly) => setExtras({ openAccessOnly })}
          />
        </label>
      </FilterSection>
    </>
  );
}

/** Everything inside the provider: it reads the running search. */
function SearchWorkspace({
  name,
  setName,
  query,
  setQuery,
  changed,
  queryUnchanged,
  downloadPdfs,
  setDownloadPdfs,
  onReset,
  onClose,
  onSave,
  topicNames,
  setTopicNames,
}: {
  name: string;
  setName: (name: string) => void;
  query: ImportQuery;
  setQuery: (update: (value: ImportQuery) => ImportQuery) => void;
  changed: boolean;
  queryUnchanged: boolean;
  downloadPdfs: boolean;
  setDownloadPdfs: (value: boolean) => void;
  onReset: () => void;
  onClose: () => void;
  onSave: (count: number) => void;
  topicNames: Record<string, string>;
  setTopicNames: (update: (value: Record<string, string>) => Record<string, string>) => void;
}) {
  const search = useSearch();
  const narrow = useIsTablet();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const [choosingFromHistory, setChoosingFromHistory] = useState(false);
  const reducedMotion = useReducedMotion();
  const { params, extras } = query;
  const setExtras = (change: Partial<OpenAlexImportExtras>) =>
    setQuery((value) => ({ ...value, extras: { ...value.extras, ...change } }));
  const clearAll = () =>
    setQuery((value) => ({
      params: { ...DEFAULT_SEARCH_PARAMS, q: value.params.q, lang: value.params.lang },
      extras: EMPTY_IMPORT_EXTRAS,
    }));
  const busy = search.isLoading || search.isValidating;

  const activeFilters =
    countActiveFilters({
      field: params.field as SearchField,
      sortBy: DEFAULT_FILTERS.sortBy,
      yearRange: params.yf && params.yt ? [params.yf, params.yt] : DEFAULT_FILTERS.yearRange(),
      dateRange:
        params.df || params.dt
          ? { from: params.df ? new Date(params.df) : undefined, to: params.dt ? new Date(params.dt) : undefined }
          : undefined,
      filterType: params.ft as "date" | "year",
      isYearRangeEnabled: Boolean(params.yf || params.yt),
      selectedRegions: params.reg,
      selectedCountryFocus: params.focus,
      ratingRange: DEFAULT_FILTERS.ratingRange,
      onlyRatedPapers: false,
      citesItemId: params.cites,
      citedByItemId: params.citedBy,
      relatedToItemId: params.rel,
      reviewFilter: params.review,
    }) +
    (extras.topicIds.length ? 1 : 0) +
    (extras.sdgs.length ? 1 : 0) +
    (extras.openAccessOnly ? 1 : 0) + Object.keys(extras.additionalFilters ?? {}).length;

  const unbounded = !buildOpenAlexSourceQuery(query);
  const canApprove = queryUnchanged || (!busy && !search.error && search.validation.isValid && search.totalCount > 0);

  const sidebarContents = (
        <SidebarContent
          hideHeader
          isMobileSheet
          hidePanels={["rating", "sort"]}
          activeFiltersCount={activeFilters}
          isCitesActive={isCitesFilterActive(params.cites)}
          isCitedByActive={isCitedByFilterActive(params.citedBy)}
          isRelatedToActive={isRelatedToFilterActive(params.rel)}
          onClearAllFilters={clearAll}
        >
          <ImportOnlyFilters
            extras={extras}
            setExtras={setExtras}
            topicNames={topicNames}
            setTopicNames={setTopicNames}
          />
        </SidebarContent>
  );

  return (
    <div className="relative mx-auto flex min-h-0 w-full max-w-[96rem] flex-1 flex-col justify-center gap-2 px-2 sm:px-4 lg:flex-row">
      {/* The filter cards float on the overlay: no panel behind them, so each
          card is opaque and carries its own shadow. While a search is being
          chosen from history they have nothing to act on: they slide in
          behind the panel and fade, and the panel glides to the centre. */}
      <AnimatePresence initial={false} mode="popLayout">
        {!choosingFromHistory && !narrow && (
      <motion.aside
        key="filters"
        aria-label="Filters"
        initial={reducedMotion ? false : { x: 96, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={reducedMotion ? { opacity: 0 } : { x: 96, opacity: 0 }}
        transition={reducedMotion ? { duration: 0 } : sidebarSpring}
        className="z-0 min-h-0 w-full shrink-0 overflow-y-auto [scrollbar-width:none] lg:w-80 [&_[data-filter-section=active]]:bg-sidebar-accent [&_[data-filter-section=idle]]:bg-card [&_[data-filter-section]]:shadow-lg [&_[data-filter-section]]:shadow-black/10"
        data-openalex-filters
      >
        <div className="sticky top-0 z-10 flex justify-end px-4 pt-4">
          <div className="flex min-h-10 items-center gap-1 rounded-lg border border-border/30 bg-background/95 p-1 shadow-lg shadow-black/10">
            <AnimatePresence>
              {activeFilters > 0 && <FilterCountControl count={activeFilters} onClearAll={clearAll} />}
            </AnimatePresence>
            <span className="flex h-8 items-center gap-1.5 px-2 text-sm font-medium text-muted-foreground">
              <Filter className="h-4 w-4" />
              Filters
            </span>
          </div>
        </div>
        {sidebarContents}
      </motion.aside>
        )}
      </AnimatePresence>

      {/* Same width either way, so only its position animates and nothing inside stretches. */}
      <motion.div
        layout="position"
        transition={reducedMotion ? { duration: 0 } : sidebarSpring}
        className="relative z-10 my-4 flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-2xl border border-border/50 bg-sidebar shadow-2xl lg:w-[calc(100%-20.5rem)] lg:flex-none"
        data-openalex-preview
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mb-4 flex items-center gap-3">
            {/* The name sizes to its text so the pencil sits right beside it. */}
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <input
                ref={nameRef}
                aria-label="Name of this search"
                value={name}
                maxLength={80}
                placeholder="Name this search"
                onChange={(event) => setName(event.target.value)}
                className="-ml-2 min-w-40 max-w-full field-sizing-content rounded-lg border border-transparent bg-transparent px-2 py-1 text-xl font-semibold outline-none transition-colors placeholder:text-muted-foreground/50 hover:border-border/60 focus:border-primary/50 focus:bg-background focus:ring-2 focus:ring-primary/10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Edit the name"
                className="size-8 shrink-0 rounded-lg text-muted-foreground hover:text-foreground"
                onClick={() => {
                  nameRef.current?.focus();
                  nameRef.current?.select();
                }}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            </div>
            {narrow && !choosingFromHistory && (
              <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
                <SheetTrigger asChild><Button variant="outline" size="icon" aria-label="Filters"><Filter /></Button></SheetTrigger>
                <SheetContent side="left" className="flex w-full max-w-full flex-col gap-0 p-0 sm:max-w-md">
                  <SheetHeader className="shrink-0 border-b p-4"><SheetTitle>Filters</SheetTitle></SheetHeader>
                  <div className="min-h-0 flex-1 overflow-y-auto">{sidebarContents}</div>
                  <div className="shrink-0 border-t p-4"><Button className="w-full" onClick={() => setFiltersOpen(false)}>Done</Button></div>
                </SheetContent>
              </Sheet>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 shrink-0 rounded-lg"
              aria-label={choosingFromHistory ? "Back to results" : "From my search history"}
              aria-pressed={choosingFromHistory}
              data-history-trigger
              onClick={() => setChoosingFromHistory(!choosingFromHistory)}
            >
              {choosingFromHistory ? <ArrowLeft /> : <History />}
              <span className="hidden sm:inline">{choosingFromHistory ? "Back to results" : "From my search history"}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 rounded-lg"
              aria-label="Close"
              onClick={onClose}
            >
              <X />
            </Button>
          </div>

          {search.error && !choosingFromHistory ? <p role="alert" className="mb-3 text-sm text-destructive">{search.error.message}</p> : null}
          {choosingFromHistory ? (
            // The history page itself, choosing instead of opening.
            <HistoryCommandCenter
              pick={{
                label: "Use this search",
                excludeId: search.searchId,
                onPick: (entry) => {
                  const params = { ...DEFAULT_SEARCH_PARAMS, ...searchResultToParams(entry) };
                  useSearchHistoryStore.getState().updateSearchResult(search.searchId, {
                    ...paramsToSearchResult(params),
                    queryHistory: entry.queryHistory,
                    questionHistory: entry.questionHistory,
                  });
                  setQuery(() => ({ params, extras: EMPTY_IMPORT_EXTRAS }));
                  if (!name) setName(entry.query.slice(0, 80));
                  setChoosingFromHistory(false);
                },
              }}
            />
          ) : (
            <ResultsList
              preview
              onDownloadItem={() => {}}
              onDownloadEssentialItem={() => {}}
              isLoading={search.isLoading}
              isValidating={search.isValidating}
              currentQuery={params.q}
            />
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border/50 bg-background/80 px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="text-xs text-muted-foreground">
              {unbounded
                ? "Add keywords or a filter first. An empty search would import all of OpenAlex."
                : !busy && search.totalCount > 0
                  ? `Saving imports all ${search.totalCount.toLocaleString()} records and keeps them up to date.`
                  : "Nothing is imported until you save."}
            </p>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch size="sm" checked={downloadPdfs} onCheckedChange={setDownloadPdfs} />
              Process PDFs
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" className="h-9 rounded-lg" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" variant="outline" className="h-9 rounded-lg" disabled={!changed} onClick={onReset}>
              <RotateCcw />
              Reset
            </Button>
            <Button
              type="button"
              className="h-9 rounded-lg"
              disabled={!canApprove || unbounded || !name.trim()}
              onClick={() => onSave(search.totalCount)}
            >
              <Save />
              Save
            </Button>
          </div>
        </footer>
      </motion.div>
    </div>
  );
}

export function OpenAlexSearchDialog({
  initial, searchId, onClose, onApprove,
}: {
  initial: OpenAlexSourceEntry | null;
  searchId: string;
  onClose: () => void;
  onApprove: (source: OpenAlexSourceEntry) => void;
}) {
  const startingName = initial?.settings.name ?? "";
  const startingQuery = useMemo(() => readOpenAlexSourceSearch(initial), [initial]);
  const [name, setName] = useState(startingName);
  const [query, setQuery] = useState<ImportQuery>(startingQuery);
  const [downloadPdfs, setDownloadPdfs] = useState(initial?.settings.downloadPdfs ?? false);
  const [topicNames, setTopicNames] = useState<Record<string, string>>({});
  const queryUnchanged = Boolean(initial) && sameOpenAlexSourceSearch(query, startingQuery);
  const changed = name !== startingName || !queryUnchanged || downloadPdfs !== (initial?.settings.downloadPdfs ?? false);
  const extraApiFilters = useMemo(() => importExtraApiFilters(query.extras), [query.extras]);

  function save() {
    const canonical = queryUnchanged ? initial!.settings.approvedQuery.query : buildOpenAlexSourceQuery(query);
    if (!canonical) return;
    onApprove({
      key: initial?.key ?? `openalex-${crypto.randomUUID()}`,
      provider: "openalex", enabled: initial?.enabled ?? true, writebackEnabled: false,
      settings: {
        name: name.trim(), apiKeyMode: initial?.settings.apiKeyMode ?? "platform", downloadPdfs,
        searchUrl: buildResultsUrl(searchId, query.params),
        approvedQuery: approveOpenAlexQuery(initial?.settings.approvedQuery, canonical),
      },
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-dvh max-h-dvh w-screen max-w-none flex-col gap-0 overflow-visible rounded-none border-0 bg-transparent p-0 shadow-none sm:max-w-none"
        onInteractOutside={(event) => event.preventDefault()}
        // Focusing the first control would open the Clear all tooltip on arrival.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement).focus();
        }}
      >
        <DialogTitle className="sr-only">{initial ? "Change this search" : "Add a search"}</DialogTitle>
        <DialogDescription className="sr-only">Choose the search this source will keep up to date.</DialogDescription>
        <SearchProvider local={{searchId, params: query.params, extraApiFilters,
          onParamsChange: (updates) => setQuery((value) => ({...value, params: {...value.params, ...updates}})),
        }}>
          <SearchWorkspace name={name} setName={setName} query={query} setQuery={setQuery}
            changed={changed} queryUnchanged={queryUnchanged} downloadPdfs={downloadPdfs} setDownloadPdfs={setDownloadPdfs}
            onReset={() => {setName(startingName); setQuery(startingQuery); setDownloadPdfs(initial?.settings.downloadPdfs ?? false);}}
            onClose={onClose} onSave={save} topicNames={topicNames} setTopicNames={setTopicNames}
          />
        </SearchProvider>
      </DialogContent>
    </Dialog>
  );
}
