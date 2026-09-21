"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import useSWR from "swr";
import { Check, Copy, Quote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createPaperCitations } from "@/app/actions/citations";
import { paperToCitationData } from "@/lib/citations/paper-data";
import { CITATION_FORMATS, type CitationFormat, type CitationData } from "@/lib/citations/formats";
import { useAppToast } from "@/lib/toast/use-app-toast";
import type { PaperResult } from "@/lib/types";

function CitationPanel({ data }: { data: CitationData }) {
  const t = useTranslations("citation");
  const locale = useLocale();
  const toast = useAppToast();
  const [format, setFormat] = useState<CitationFormat>("apa");
  const [copied, setCopied] = useState<string | null>(null);
  const { data: result, error, isLoading, mutate } = useSWR(["citations", data, locale],
    () => createPaperCitations(data, locale),
    { revalidateOnFocus: false, revalidateOnReconnect: false, revalidateIfStale: false });
  const text = result?.citations[format];
  return <div className="space-y-3">
    <div className="flex items-center justify-between gap-2">
      <Select value={format} onValueChange={(value) => {
        const selected = CITATION_FORMATS.find((option) => option.id === value);
        if (selected) { setFormat(selected.id); setCopied(null); }
      }}>
        <SelectTrigger className="min-w-0 flex-1" aria-label={t("style")}><SelectValue /></SelectTrigger>
        <SelectContent>{CITATION_FORMATS.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectContent>
      </Select>
      <Button size="sm" variant="outline" disabled={!text} onClick={async () => {
        if (!text) return;
        try { await navigator.clipboard.writeText(text); setCopied(text); }
        catch { toast.clipboard.copyFailed(t("citation")); }
      }}>
        {copied === text && text ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied === text && text ? t("copied") : t("copy")}
      </Button>
    </div>
    {isLoading ? <p className="py-5 text-sm text-muted-foreground" role="status">{t("loading")}</p> : error ?
      <div role="alert" className="space-y-2 text-sm"><p>{t("failed")}</p><Button size="sm" variant="outline" onClick={() => void mutate()}>{t("retry")}</Button></div> :
      <p aria-live="polite" className={`max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-muted-foreground ${format === "bibtex" ? "font-mono text-xs" : "text-sm leading-relaxed"}`}>{text}</p>}
  </div>;
}

export function CitationControl({ paper, compact = true }: { paper: PaperResult; compact?: boolean }) {
  const t = useTranslations("citation");
  const [open, setOpen] = useState(false);
  const data = paperToCitationData(paper);
  if (!data) return null;
  return <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant={compact ? "ghost" : "outline"} size={compact ? "icon" : "sm"} className={compact ? "size-8" : ""} aria-label={t("cite")} title={t("cite")}>
          <Quote className="size-4" />{!compact && t("cite")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" collisionPadding={16} className="w-[min(28rem,calc(100vw-2rem))]">
        {open && <CitationPanel key={paper.id} data={data} />}
      </PopoverContent>
    </Popover>
  </div>;
}
