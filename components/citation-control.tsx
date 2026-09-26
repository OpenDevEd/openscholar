"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import useSWR, { preload } from "swr";
import { Check, Copy, Quote } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { TooltipHint } from "@/components/ui/tooltip";
import { CitationStylePicker } from "@/components/citation-style-picker";
import { CitationText } from "@/components/citation-text";
import { enrichPaperCitationMetadata } from "@/app/actions/citations";
import {
  loadPaperCitations,
  loadAdditionalCitation,
} from "@/lib/citations/client";
import { paperToCitationData } from "@/lib/citations/paper-data";
import { type CitationData } from "@/lib/citations/formats";
import { useCitationStyle } from "@/lib/citations/use-citation-style";
import { useAppToast } from "@/lib/toast/use-app-toast";
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
      {loading && !failed && !displayed ? (
        <p className="py-5 text-sm text-muted-foreground" role="status">
          {t("loading")}
        </p>
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
          className="max-h-72 overflow-y-auto text-sm text-foreground/80"
        >
          {displayed && <CitationText citation={displayed} />}
        </div>
      )}
    </div>
  );
}

export function CitationControl({
  paper,
  compact = true,
}: {
  paper: PaperResult;
  compact?: boolean;
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
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <TooltipHint label={compact ? t("cite") : undefined}>
          <PopoverTrigger asChild>
            <Button
              onPointerEnter={prepare}
              onFocus={prepare}
              variant={compact ? "ghost" : "outline"}
              size={compact ? "icon" : "sm"}
              className={compact ? "size-8" : ""}
              aria-label={t("cite")}
            >
              <Quote className="size-4" />
              {!compact && t("cite")}
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
