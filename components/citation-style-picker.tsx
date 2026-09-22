"use client";

import { useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandItem } from "@/components/ui/command";
import { CITATION_FORMATS, type CitationStyle } from "@/lib/citations/formats";
import { loadCitationStyles, searchCitationStyles } from "@/lib/citations/styles";

export function CitationStylePicker({ selected, onSelect }: { selected: CitationStyle; onSelect: (style: CitationStyle) => void }) {
  const t = useTranslations("citation");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { data, error, isLoading, mutate } = useSWR(open ? "citation-styles" : null, loadCitationStyles,
    { revalidateOnFocus: false, revalidateIfStale: false });
  const matches = searchCitationStyles(data ?? CITATION_FORMATS, query);
  return <Popover open={open} onOpenChange={value => { setOpen(value); if (!value) setQuery(""); }}>
    <PopoverTrigger asChild>
      <Button variant="outline" size="sm" role="combobox" aria-label={t("style")} aria-expanded={open}
        title={selected.label} className="min-w-0 flex-1 justify-between gap-2">
        <span className="truncate">{selected.label}</span><ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" collisionPadding={16} className="w-[min(24rem,calc(100vw-2rem))] p-0">
      <Command shouldFilter={false}>
        <CommandInput aria-label={t("searchStyles")} placeholder={t("searchStyles")} value={query} onValueChange={setQuery} />
        <CommandList aria-label={t("style")}>
          {matches.slice(0, 60).map(style => <CommandItem key={style.id} value={style.id} onSelect={() => { onSelect(style); setOpen(false); setQuery(""); }}>
            <span className="min-w-0 flex-1 whitespace-normal">{style.label}</span>
            {selected.id === style.id && <Check className="size-4 shrink-0" />}
          </CommandItem>)}
          {isLoading && <p role="status" className="px-3 py-2 text-sm text-muted-foreground">{t("loadingStyles")}</p>}
          {error && <div role="alert" className="p-3 text-sm"><p>{t("stylesFailed")}</p><Button size="sm" variant="ghost" onClick={() => void mutate()}>{t("retry")}</Button></div>}
          {!isLoading && !error && matches.length === 0 && <p role="status" className="p-3 text-sm text-muted-foreground">{t("noStyles")}</p>}
          {matches.length > 60 && <p className="px-3 py-2 text-sm text-muted-foreground">{t("refineStyles", { count: matches.length })}</p>}
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>;
}
