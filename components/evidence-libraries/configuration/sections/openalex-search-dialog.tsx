"use client";

import { useDeferredValue, useMemo, useState } from "react";
import useSWR from "swr";
import {
  CalendarRange,
  Check,
  ChevronDown,
  FileText,
  Filter,
  Globe2,
  Loader2,
  LockOpen,
  Search,
  Shapes,
  Target,
  X,
} from "lucide-react";
import { searchOpenAlexTopicOptions } from "@/app/actions/openalex-topic-options";
import {
  previewOpenAlexSource,
  type OpenAlexSourcePreview,
} from "@/app/actions/openalex-source-preview";
import { CountrySelector } from "@/components/country-selector";
import { FilterSection } from "@/components/shared/filter-section";
import { YearRangePicker } from "@/components/year-range-picker";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  approveOpenAlexQuery,
  type OpenAlexSourceEntry,
} from "@/lib/evidence-libraries/configuration/sources";
import {
  buildOpenAlexSourceQuery,
  emptyOpenAlexSourceQuery,
  OPENALEX_SDGS,
  OPENALEX_WORK_TYPES,
  parseOpenAlexSourceQuery,
  type OpenAlexSearchScope,
  type OpenAlexTopicLevel,
  type OpenAlexSourceQueryBuilder,
} from "@/lib/evidence-libraries/openalex-source-query";
import { SEARCH_FIELDS } from "@/lib/types";
import { useSourceTopicNames } from "./use-source-topic-names";
import { cn } from "@/lib/utils";
import { useIsTablet } from "@/lib/hooks";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

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

function toggle(values: string[], id: string): string[] {
  return values.includes(id)
    ? values.filter((value) => value !== id)
    : [...values, id];
}

const TOPIC_LEVELS: { value: OpenAlexTopicLevel; label: string }[] = [
  { value: "field", label: "Fields" },
  { value: "subfield", label: "Subfields" },
  { value: "topic", label: "Topics" },
];

function Filters({
  builder,
  onChange,
  topicNames,
  setTopicNames,
}: {
  builder: OpenAlexSourceQueryBuilder;
  onChange: (change: Partial<OpenAlexSourceQueryBuilder>) => void;
  topicNames: Record<string, string>;
  setTopicNames: (
    update: (value: Record<string, string>) => Record<string, string>,
  ) => void;
}) {
  const [topicSearch, setTopicSearch] = useState("");
  const deferredSearch = useDeferredValue(topicSearch);
  const topics = useSWR(
    ["source-research-areas", builder.topicLevel, deferredSearch],
    ([, level, search]) => searchOpenAlexTopicOptions(level, search),
    { revalidateOnFocus: false },
  );
  const topicOptions = topics.data ?? [];
  const workTypeNames = Object.fromEntries(
    OPENALEX_WORK_TYPES.map((type) => [type.id, type.name]),
  );
  const sdgNames = Object.fromEntries(
    OPENALEX_SDGS.map((goal) => [goal.id, goal.name]),
  );
  return (
    <aside
      aria-label="Filters"
      className="min-h-0 w-full shrink-0 overflow-y-auto px-4 pb-4 lg:w-80 lg:px-0"
    >
      <div className="sticky top-0 z-10 flex items-center gap-2 bg-background/95 px-1 py-4 text-sm font-medium text-muted-foreground backdrop-blur">
        <Filter className="size-4" /> Filters
      </div>
      <div className="space-y-3">
        <FilterSection
          title="Search scope"
          icon={Target}
          isActive={builder.scope !== "title_and_abstract"}
          onClear={() => onChange({ scope: "title_and_abstract" })}
        >
          <Select
            value={builder.scope}
            onValueChange={(scope) =>
              onChange({ scope: scope as OpenAlexSearchScope })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All fields</SelectItem>
              {SEARCH_FIELDS.map((field) => (
                <SelectItem key={field.value} value={field.value}>
                  {field.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterSection>
        <FilterSection
          title="Publication years"
          icon={CalendarRange}
          isActive={builder.yearRange !== null}
          onClear={() => onChange({ yearRange: null })}
        >
          <YearRangePicker
            yearRange={builder.yearRange ?? [2020, new Date().getFullYear()]}
            onYearRangeChange={(yearRange) => onChange({ yearRange })}
            isActive={builder.yearRange !== null}
          />
        </FilterSection>
        <FilterSection
          title="Author locations"
          icon={Globe2}
          isActive={builder.locations.length > 0}
          onClear={() => onChange({ locations: [] })}
        >
          <CountrySelector
            selectedRegions={builder.locations}
            onSelectionChange={(locations) => onChange({ locations })}
            placeholder="Any country or region"
          />
        </FilterSection>
        <FilterSection
          title="Work types"
          icon={FileText}
          isActive={builder.types.length > 0}
          onClear={() => onChange({ types: [] })}
        >
          <OptionPicker
            label="Work types"
            placeholder="Any work type"
            options={OPENALEX_WORK_TYPES}
            selected={builder.types}
            names={workTypeNames}
            onToggle={(option) =>
              onChange({ types: toggle(builder.types, option.id) })
            }
          />
        </FilterSection>
        <FilterSection
          title="Research areas"
          icon={Shapes}
          isActive={builder.topicIds.length > 0}
          onClear={() => onChange({ topicIds: [] })}
        >
          <div className="space-y-2">
            <div
              className="grid grid-cols-3 rounded-lg bg-muted p-1"
              aria-label="Research area level"
            >
              {TOPIC_LEVELS.map((level) => (
                <Button
                  key={level.value}
                  type="button"
                  size="sm"
                  variant={
                    builder.topicLevel === level.value ? "secondary" : "ghost"
                  }
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    onChange({ topicLevel: level.value, topicIds: [] });
                    setTopicSearch("");
                  }}
                >
                  {level.label}
                </Button>
              ))}
            </div>
            <div>
              <OptionPicker
                label="Research areas"
                placeholder="Any research area"
                options={topicOptions.map((option) => ({
                  id: option.id,
                  name: option.name,
                  hint: option.within,
                }))}
                selected={builder.topicIds}
                names={topicNames}
                loading={topics.isLoading}
                error={Boolean(topics.error)}
                onSearch={setTopicSearch}
                onToggle={(option) => {
                  setTopicNames((value) => ({
                    ...value,
                    [option.id]: option.name,
                  }));
                  onChange({ topicIds: toggle(builder.topicIds, option.id) });
                }}
              />
            </div>
          </div>
        </FilterSection>
        <FilterSection
          title="SDGs"
          icon={Target}
          isActive={builder.sdgs.length > 0}
          onClear={() => onChange({ sdgs: [] })}
        >
          <OptionPicker
            label="SDGs"
            placeholder="Any SDG"
            options={OPENALEX_SDGS}
            selected={builder.sdgs}
            names={sdgNames}
            onToggle={(option) =>
              onChange({ sdgs: toggle(builder.sdgs, option.id) })
            }
          />
        </FilterSection>
        <FilterSection
          title="Open access"
          icon={LockOpen}
          isActive={builder.openAccessOnly}
          onClear={() => onChange({ openAccessOnly: false })}
        >
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm">Only open access works</span>
            <Switch
              checked={builder.openAccessOnly}
              onCheckedChange={(openAccessOnly) => onChange({ openAccessOnly })}
              aria-label="Only open access works"
            />
          </label>
        </FilterSection>
      </div>
    </aside>
  );
}

export function OpenAlexSearchDialog({
  initial,
  onClose,
  onApprove,
}: {
  initial: OpenAlexSourceEntry | null;
  onClose: () => void;
  onApprove: (source: OpenAlexSourceEntry) => void;
}) {
  const narrow = useIsTablet();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const startingBuilder = useMemo(
    () =>
      initial
        ? parseOpenAlexSourceQuery(initial.settings.approvedQuery.query)
        : emptyOpenAlexSourceQuery(),
    [initial],
  );
  const [name, setName] = useState(initial?.settings.name ?? "");
  const [builder, setBuilder] = useState(startingBuilder);
  const [downloadPdfs, setDownloadPdfs] = useState(
    initial?.settings.downloadPdfs ?? false,
  );
  const [topicNames, setTopicNames] = useState<Record<string, string>>({});
  const savedTopicNames = useSourceTopicNames(builder.topicLevel, builder.topicIds);
  const [preview, setPreview] = useState<OpenAlexSourcePreview | null>(null);
  const [previewedQuery, setPreviewedQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const query = buildOpenAlexSourceQuery(builder);
  const queryKey = JSON.stringify(query);
  const initialQuery = initial?.settings.approvedQuery.query;
  const queryUnchanged =
    initialQuery !== undefined &&
    initialQuery.search === query.search &&
    initialQuery.filter === query.filter;
  const queryApproved =
    queryUnchanged || (preview?.ok === true && previewedQuery === queryKey);
  const canSave = queryApproved && name.trim().length > 0;
  const hasQuery = Boolean(query.search || query.filter);

  async function runPreview() {
    setLoading(true);
    try {
      const result = await previewOpenAlexSource(query);
      setPreview(result);
      setPreviewedQuery(queryKey);
    } catch {
      setPreview({
        ok: false,
        message: "The preview could not be loaded. Try again.",
      });
    } finally {
      setLoading(false);
    }
  }

  function save() {
    if (!canSave) return;
    const approvedQuery = approveOpenAlexQuery(
      initial?.settings.approvedQuery,
      query,
    );
    onApprove({
      key: initial?.key ?? `openalex-${crypto.randomUUID()}`,
      provider: "openalex",
      enabled: initial?.enabled ?? true,
      writebackEnabled: false,
      settings: {
        name: name.trim(),
        apiKeyMode: initial?.settings.apiKeyMode ?? "platform",
        approvedQuery,
        downloadPdfs,
      },
    });
  }

  const filters = (
    <Filters
      builder={builder}
      onChange={(change) => setBuilder((value) => ({ ...value, ...change }))}
      topicNames={{ ...savedTopicNames, ...topicNames }}
      setTopicNames={setTopicNames}
    />
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-dvh max-h-dvh w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 bg-background p-0 shadow-none sm:max-w-none"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogTitle className="sr-only">
          {initial ? "Change OpenAlex search" : "Add OpenAlex search"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Choose the records that OpenAlex should keep up to date.
        </DialogDescription>
        <div className="mx-auto flex min-h-0 w-full max-w-[96rem] flex-1 gap-2 lg:px-4">
          {!narrow && filters}
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card lg:my-4 lg:rounded-2xl lg:border lg:border-border/60 lg:shadow-xl">
            <header className="flex items-center gap-3 border-b border-border/60 p-4 sm:px-6">
              <Input
                aria-label="Name of this search"
                value={name}
                maxLength={80}
                placeholder="Name this search"
                onChange={(event) => setName(event.target.value)}
                className="h-10 min-w-0 flex-1 border-transparent bg-transparent px-0 text-lg font-semibold shadow-none focus-visible:border-transparent focus-visible:ring-0"
              />
              {narrow && (
                <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
                  <SheetTrigger asChild>
                    <Button type="button" variant="outline" size="icon" aria-label="Filters">
                      <Filter />
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="flex w-full max-w-full flex-col gap-0 p-0 sm:max-w-md">
                    <SheetHeader className="shrink-0 border-b p-4">
                      <SheetTitle>Filters</SheetTitle>
                    </SheetHeader>
                    <div className="min-h-0 flex-1 overflow-y-auto">{filters}</div>
                    <div className="shrink-0 border-t p-4">
                      <Button className="w-full" onClick={() => setFiltersOpen(false)}>Done</Button>
                    </div>
                  </SheetContent>
                </Sheet>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Close"
                onClick={onClose}
              >
                <X />
              </Button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
              <div className="mx-auto max-w-3xl space-y-5">
                <div className="space-y-2">
                  <label
                    htmlFor="openalex-search"
                    className="text-sm font-medium"
                  >
                    Search
                  </label>
                  <Textarea
                    id="openalex-search"
                    value={builder.search}
                    maxLength={2_048}
                    placeholder="Enter keywords or a Boolean search"
                    className="min-h-24 resize-y"
                    onChange={(event) =>
                      setBuilder((value) => ({
                        ...value,
                        search: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-medium">Preview</h2>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={loading || !hasQuery}
                    onClick={() => void runPreview()}
                  >
                    {loading ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Search />
                    )}
                    Preview results
                  </Button>
                </div>
                {preview?.ok === false ? (
                  <p className="text-sm text-destructive">{preview.message}</p>
                ) : null}
                {preview?.ok === true ? (
                  preview.works.length ? (
                    <ul className="divide-y divide-border/60 rounded-xl border border-border/60 bg-background px-4">
                      {preview.works.map((work) => (
                        <li key={work.id} className="py-3">
                          <p className="text-sm font-medium">{work.title}</p>
                          {work.publicationYear ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {work.publicationYear}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                      No matching works.
                    </p>
                  )
                ) : (
                  <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                    Add a search or filter, then preview the results.
                  </p>
                )}
              </div>
            </div>
            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 bg-background/80 px-4 py-3 sm:px-6">
              <label className="flex items-center gap-3">
                <Switch
                  checked={downloadPdfs}
                  onCheckedChange={setDownloadPdfs}
                  aria-label="Process PDFs"
                />
                <span>
                  <span className="block text-sm font-medium">
                    Process PDFs
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Download available full text
                  </span>
                </span>
              </label>
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="button" disabled={!canSave} onClick={save}>
                  Save search
                </Button>
              </div>
            </footer>
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
}
