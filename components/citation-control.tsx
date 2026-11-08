"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import useSWR, { preload } from "swr";
import { Check, Copy, Download, Quote } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { TooltipHint } from "@/components/ui/tooltip";
import { CitationStylePicker } from "@/components/citation-style-picker";
import { CitationText } from "@/components/citation-text";
import { Spinner } from "@/components/ui/spinner";
import { AutoHeight } from "@/components/ui/auto-height";
import { enrichPaperCitationMetadata } from "@/app/actions/citations";
import {
  loadPaperCitations,
  loadAdditionalCitation,
} from "@/lib/citations/client";
import { paperToCitationData } from "@/lib/citations/paper-data";
import { type CitationData } from "@/lib/citations/formats";
import type { CitationFile } from "@/lib/citations/formatter";
import { useCitationStyle } from "@/lib/citations/use-citation-style";
import { useAppToast } from "@/lib/toast/use-app-toast";
import { toast as sonner } from "sonner";
import type { PaperResult } from "@/lib/types";

function CitationPanel({ data }: { data: CitationData }) {
  const t = useTranslations("citation");
  const locale = useLocale();
  const toast = useAppToast();
  const {
    style: format,
    setStyle: setFormat,
    error: styleError,
    retry: retryStyle,
  } = useCitationStyle();
  const [copied, setCopied] = useState<string | null>(null);
  const { data: enriched } = useSWR(
    data.DOI ? ["citation-metadata", data] : null,
    () => enrichPaperCitationMetadata(data),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      shouldRetryOnError: false,
    },
  );
  const {
    data: result,
    error,
    isLoading,
    mutate,
  } = useSWR(
    ["paper-citations", enriched ?? data, locale],
    loadPaperCitations,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      keepPreviousData: true,
    },
  );
  const extra = useSWR(
    format && format.asset
      ? (["citation-style", enriched ?? data, locale, format] as const)
      : null,
    loadAdditionalCitation,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
    },
  );
  const citation = !format
    ? undefined
    : format.asset !== undefined
      ? extra.data
      : result?.citations[format.id];
  const loading = !format || (format.asset ? extra.isLoading : isLoading);
  const failed = styleError || (format?.asset ? extra.error : error);
  const text = citation?.text;
  const [displayed, setDisplayed] = useState(citation);
  if (citation && citation !== displayed) setDisplayed(citation);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <CitationStylePicker
          selected={format}
          onSelect={(style) => {
            setFormat(style);
            setCopied(null);
          }}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!text || loading || Boolean(failed)}
          onClick={async () => {
            if (!text) return;
            try {
              await navigator.clipboard.writeText(text);
              setCopied(text);
            } catch {
              toast.clipboard.copyFailed(t("citation"));
            }
          }}
        >
          {copied === text && text ? (
            <Check className="size-4" />
          ) : (
            <Copy className="size-4" />
          )}
          {copied === text && text ? t("copied") : t("copy")}
        </Button>
      </div>
      {/* The citation arrives after the panel opens: its height animates, so the download row below glides instead of jumping. */}
      <AutoHeight>
      {loading && !failed && !displayed ? (
        <div className="flex justify-center py-5">
          <Spinner className="size-5" aria-label={t("loading")} />
        </div>
      ) : failed ? (
        <div role="alert" className="space-y-2 text-sm">
          <p>{t("failed")}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (styleError) retryStyle();
              else void (format?.asset ? extra.mutate() : mutate());
            }}
          >
            {t("retry")}
          </Button>
        </div>
      ) : (
        <div
          aria-live="polite"
          aria-busy={loading}
          className="max-h-72 overflow-y-auto text-sm text-foreground/80 animate-in fade-in duration-200"
        >
          {displayed && <CitationText citation={displayed} />}
        </div>
      )}
      </AutoHeight>
      <CitationFiles data={enriched ?? data} />
    </div>
  );
}

/** The paper as a file for a reference manager, made here from the same record the citation is. */
function CitationFiles({ data }: { data: CitationData }) {
  const t = useTranslations("citation");
  const toast = useAppToast();
  const save = async (kind: CitationFile) => {
    try {
      const { citationFile } = await import("@/lib/citations/formatter");
      const file = citationFile(data, kind);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([file.text], { type: file.type }));
      link.download = file.name;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch {
      toast.clipboard.copyFailed(t("citation"));
    }
  };
  return (
    <div className="-mx-1 flex items-center gap-1 border-t pt-2">
      <span className="me-auto ps-1 text-xs text-muted-foreground">{t("download")}</span>
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void save("ris")}>
        <Download className="size-3.5" />
        RIS
      </Button>
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void save("bibtex")}>
        <Download className="size-3.5" />
        BibTeX
      </Button>
    </div>
  );
}

export function CitationControl({
  paper,
  compact = true,
  iconOnly = false,
}: {
  paper: PaperResult;
  compact?: boolean;
  /** An outlined icon, as the focus mode header draws its controls, each with its key beside it. */
  iconOnly?: boolean;
}) {
  const t = useTranslations("citation");
  const [open, setOpen] = useState(false);
  const locale = useLocale();
  const data = paperToCitationData(paper);
  if (!data) return null;
  const prepare = () => {
    void preload(["paper-citations", data, locale], loadPaperCitations).catch(
      () => {
        /* The panel exposes retry. */
      },
    );
    if (data.DOI)
      void preload(["citation-metadata", data], () =>
        enrichPaperCitationMetadata(data),
      ).catch(() => {
        /* Loaded metadata remains usable. */
      });
  };
  return (
    <div
      onClick={(event) => event.stopPropagation()}
      // Enter and Space on it stay with it, so a card it sits in doesn't open; other keys reach the page, so focus mode's shortcuts work after it.
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); }}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <TooltipHint label={compact && !iconOnly ? t("cite") : undefined}>
          <PopoverTrigger asChild>
            <Button
              onPointerEnter={prepare}
              onFocus={prepare}
              variant={compact && !iconOnly ? "ghost" : "outline"}
              size={iconOnly ? "icon-sm" : compact ? "icon" : "sm"}
              className={iconOnly ? undefined : compact ? "size-8" : "max-sm:w-8 max-sm:px-0"}
              aria-label={t("cite")}
            >
              <Quote className={iconOnly ? "h-3 w-3" : "size-4"} />
              {/* Phones show the icon alone, as the rest of the focus mode header does. */}
              {!compact && !iconOnly && <span className="hidden sm:inline">{t("cite")}</span>}
            </Button>
          </PopoverTrigger>
        </TooltipHint>
        <PopoverContent
          align="end"
          collisionPadding={16}
          className="w-[min(28rem,calc(100vw-2rem))]"
        >
          {open && <CitationPanel key={paper.id} data={data} />}
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * Copies a paper's citation in the style last picked in Cite, without opening it: what C does in focus mode. It reads
 * through the same cache as Cite's panel, so opening Cite afterwards shows it at once.
 */
export function useCopyCitation() {
  const t = useTranslations("citation");
  const locale = useLocale();
  const toast = useAppToast();
  const { style } = useCitationStyle();
  return async (paper: PaperResult) => {
    const data = paperToCitationData(paper);
    if (!data || !style) return;
    try {
      const enriched = data.DOI ? await preload(["citation-metadata", data], () => enrichPaperCitationMetadata(data)).catch(() => data) : data;
      const citation = style.asset !== undefined
        ? await preload(["citation-style", enriched, locale, style] as const, loadAdditionalCitation)
        : (await preload(["paper-citations", enriched, locale], loadPaperCitations)).citations[style.id];
      if (!citation?.text) throw new Error("No citation in that style");
      await navigator.clipboard.writeText(citation.text);
      sonner.success(t("copiedIn", { style: style.label }));
    } catch {
      toast.clipboard.copyFailed(t("citation"));
    }
  };
}
