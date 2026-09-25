"use client";

import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Filter, History, Pencil, RotateCcw, Save, X } from "lucide-react";
import { HistoryCommandCenter } from "@/components/history-command-center";
import { ResultsList } from "@/components/results-list";
import { SidebarContent } from "@/components/search-sidebar";
import { FilterCountControl } from "@/components/shared/filter-count-control";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { approveOpenAlexQuery, type OpenAlexSourceEntry } from "@/lib/evidence-libraries/configuration/sources";
import { buildOpenAlexSourceQuery, readOpenAlexSourceSearch, sameOpenAlexSourceSearch } from "@/lib/evidence-libraries/openalex-source-query";
import { countActiveFilters } from "@/lib/filters";
import { useIsTablet } from "@/lib/hooks";
import { DEFAULT_SEARCH_PARAMS, SearchProvider, useSearch, type SearchParams } from "@/lib/search";
import { buildResultsUrl, paramsToSearchResult, searchResultToParams } from "@/lib/search-params";
import { useSearchHistoryStore } from "@/lib/store";
import { sidebarSpring } from "@/lib/ui/sidebar-motion";
import { isCitedByFilterActive, isCitesFilterActive, isRelatedToFilterActive } from "@/lib/utils";

/** Everything inside the provider: it reads the running search. */
function SearchWorkspace({
  name,
  setName,
  params,
  setParams,
  changed,
  queryUnchanged,
  downloadPdfs,
  setDownloadPdfs,
  onReset,
  onClose,
  onSave,
}: {
  name: string;
  setName: (name: string) => void;
  params: SearchParams;
  setParams: (update: (value: SearchParams) => SearchParams) => void;
  changed: boolean;
  queryUnchanged: boolean;
  downloadPdfs: boolean;
  setDownloadPdfs: (value: boolean) => void;
  onReset: () => void;
  onClose: () => void;
  onSave: (count: number) => void;
}) {
  const t = useTranslations("evidenceLibraryConfiguration.sources.openAlex");
  const tc = useTranslations("common");
  const search = useSearch();
  const narrow = useIsTablet();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const [choosingFromHistory, setChoosingFromHistory] = useState(false);
  const reducedMotion = useReducedMotion();
  const clearAll = () =>
    setParams((value) => ({ ...DEFAULT_SEARCH_PARAMS, q: value.q, lang: value.lang }));
  const busy = search.isLoading || search.isValidating;

  // Sort and ratings do not change what a source imports, so they are not counted.
  const activeFilters = countActiveFilters({
    ...paramsToSearchResult(params),
    sortBy: undefined,
    ratingRange: undefined,
    onlyRatedPapers: undefined,
  });

  const unbounded = !buildOpenAlexSourceQuery(params);
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
        />
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
        aria-label={tc("filters")}
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
              {tc("filters")}
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
                aria-label={t("nameLabel")}
                value={name}
                maxLength={80}
                placeholder={t("namePlaceholder")}
                onChange={(event) => setName(event.target.value)}
                className="-ml-2 min-w-40 max-w-full field-sizing-content rounded-lg border border-transparent bg-transparent px-2 py-1 text-xl font-semibold outline-none transition-colors placeholder:text-muted-foreground/50 hover:border-border/60 focus:border-primary/50 focus:bg-background focus:ring-2 focus:ring-primary/10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("editName")}
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
                <SheetTrigger asChild><Button variant="outline" size="icon" aria-label={tc("filters")}><Filter /></Button></SheetTrigger>
                <SheetContent side="left" className="flex w-full max-w-full flex-col gap-0 p-0 sm:max-w-md">
                  <SheetHeader className="shrink-0 border-b p-4"><SheetTitle>{tc("filters")}</SheetTitle></SheetHeader>
                  <div className="min-h-0 flex-1 overflow-y-auto">{sidebarContents}</div>
                  <div className="shrink-0 border-t p-4"><Button className="w-full" onClick={() => setFiltersOpen(false)}>{t("done")}</Button></div>
                </SheetContent>
              </Sheet>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 shrink-0 rounded-lg"
              aria-label={choosingFromHistory ? t("backToResults") : t("fromHistory")}
              aria-pressed={choosingFromHistory}
              data-history-trigger
              onClick={() => setChoosingFromHistory(!choosingFromHistory)}
            >
              {choosingFromHistory ? <ArrowLeft /> : <History />}
              <span className="hidden sm:inline">{choosingFromHistory ? t("backToResults") : t("fromHistory")}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 rounded-lg"
              aria-label={tc("close")}
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
                label: t("useSearch"),
                excludeId: search.searchId,
                onPick: (entry) => {
                  const picked = { ...DEFAULT_SEARCH_PARAMS, ...searchResultToParams(entry) };
                  useSearchHistoryStore.getState().updateSearchResult(search.searchId, {
                    ...paramsToSearchResult(picked),
                    queryHistory: entry.queryHistory,
                    questionHistory: entry.questionHistory,
                  });
                  setParams(() => picked);
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
                ? t("unbounded")
                : !busy && search.totalCount > 0
                  ? t("importsAll", { count: search.totalCount })
                  : t("nothingImported")}
            </p>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch size="sm" checked={downloadPdfs} onCheckedChange={setDownloadPdfs} />
              {t("processPdfs")}
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" className="h-9 rounded-lg" onClick={onClose}>
              {tc("cancel")}
            </Button>
            <Button type="button" variant="outline" className="h-9 rounded-lg" disabled={!changed} onClick={onReset}>
              <RotateCcw />
              {tc("reset")}
            </Button>
            <Button
              type="button"
              className="h-9 rounded-lg"
              disabled={!canApprove || unbounded || !name.trim()}
              onClick={() => onSave(search.totalCount)}
            >
              <Save />
              {tc("save")}
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
  const t = useTranslations("evidenceLibraryConfiguration.sources.openAlex");
  const startingName = initial?.settings.name ?? "";
  const startingParams = useMemo(() => readOpenAlexSourceSearch(initial), [initial]);
  const [name, setName] = useState(startingName);
  const [params, setParams] = useState<SearchParams>(startingParams);
  const [downloadPdfs, setDownloadPdfs] = useState(initial?.settings.downloadPdfs ?? false);
  const queryUnchanged = Boolean(initial) && sameOpenAlexSourceSearch(params, startingParams);
  const changed = name !== startingName || !queryUnchanged || downloadPdfs !== (initial?.settings.downloadPdfs ?? false);

  function save() {
    const canonical = queryUnchanged ? initial!.settings.approvedQuery.query : buildOpenAlexSourceQuery(params);
    if (!canonical) return;
    onApprove({
      key: initial?.key ?? `openalex-${crypto.randomUUID()}`,
      provider: "openalex", enabled: initial?.enabled ?? true, writebackEnabled: false,
      settings: {
        name: name.trim(), apiKeyMode: initial?.settings.apiKeyMode ?? "platform", downloadPdfs,
        searchUrl: buildResultsUrl(searchId, params),
        approvedQuery: approveOpenAlexQuery(initial?.settings.approvedQuery, canonical),
      },
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/75"
        className="flex h-dvh max-h-dvh w-screen max-w-none flex-col gap-0 overflow-visible rounded-none border-0 bg-transparent p-0 shadow-none sm:max-w-none"
        onInteractOutside={(event) => event.preventDefault()}
        // Focusing the first control would open the Clear all tooltip on arrival.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement).focus();
        }}
      >
        <DialogTitle className="sr-only">{initial ? t("changeTitle") : t("addTitle")}</DialogTitle>
        <DialogDescription className="sr-only">{t("dialogDescription")}</DialogDescription>
        <SearchProvider local={{searchId, params,
          onParamsChange: (updates) => setParams((value) => ({...value, ...updates})),
        }}>
          <SearchWorkspace name={name} setName={setName} params={params} setParams={setParams}
            changed={changed} queryUnchanged={queryUnchanged} downloadPdfs={downloadPdfs} setDownloadPdfs={setDownloadPdfs}
            onReset={() => {setName(startingName); setParams(startingParams); setDownloadPdfs(initial?.settings.downloadPdfs ?? false);}}
            onClose={onClose} onSave={save}
          />
        </SearchProvider>
      </DialogContent>
    </Dialog>
  );
}
