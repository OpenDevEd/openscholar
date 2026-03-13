"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CITATION_BAR_COLORS } from "@/lib/extraction/card-thresholds";

export interface CitationStatusMix {
  grounded: number;
  best_effort: number;
  insufficient_evidence: number;
  extraction_error: number;
}

export interface AnswerItem {
  answer: string;
  count: number;
  citationStatusMix: CitationStatusMix;
}

export interface StackedAnswerBarsProps {
  answers: AnswerItem[];
  maxCount: number;
}

export type CitationStatusLabels = Record<keyof CitationStatusMix, string>;

const STATUS_KEYS = ["grounded", "best_effort", "insufficient_evidence", "extraction_error"] as const;

export function StackedAnswerBars({
  answers,
  maxCount,
}: StackedAnswerBarsProps): React.ReactElement {
  const tc = useTranslations("common");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const te: any = useTranslations("extraction");

  const labels: CitationStatusLabels = {
    grounded: tc("grounded"),
    best_effort: (tc as any)("bestEffort"),
    insufficient_evidence: (tc as any)("insufficientEvidence"),
    extraction_error: (tc as any)("extractionError"),
  };

  const allEmpty = answers.every((a) => a.count === 0);

  if (allEmpty) {
    return (
      <div className="text-sm text-muted-foreground py-6 text-center">
        {te("noAnswerValues")}
      </div>
    );
  }

  const safMax = Math.max(maxCount, 1);

  return (
    <div className="flex flex-col gap-2.5">
      {answers.map((answer, idx) => {
        const mix = answer.citationStatusMix;
        const total = mix.grounded + mix.best_effort + mix.insufficient_evidence + mix.extraction_error;
        const safeTotal = Math.max(total, 1);
        const barWidthPct = (total / safMax) * 100;
        const ariaLabel = `${answer.answer}: ${mix.grounded} ${labels.grounded}, ${mix.best_effort} ${labels.best_effort}, ${mix.insufficient_evidence} ${labels.insufficient_evidence}, ${mix.extraction_error} ${labels.extraction_error}`;

        return (
          <div key={idx} data-testid="answer-bar-row" className="flex items-center gap-3 group">
            <span
              className="text-sm text-foreground/90 truncate min-w-0 w-28 sm:w-36 shrink-0 group-hover:text-foreground transition-colors"
              title={answer.answer}
            >
              {answer.answer}
            </span>
            <span className="text-xs font-mono tabular-nums text-muted-foreground shrink-0 w-8 text-right">
              {answer.count}
            </span>
            <div
              className="flex-1 h-6 rounded-sm overflow-hidden bg-muted/30 dark:bg-muted/20"
              role="img"
              aria-label={ariaLabel}
            >
              <div
                className="flex h-full rounded-sm overflow-hidden"
                style={{ width: `${barWidthPct}%` }}
              >
                {STATUS_KEYS.map((key) => {
                  const value = mix[key];
                  if (value === 0) return null;
                  const widthPct = (value / safeTotal) * 100;
                  const pctOfTotal = Math.round((value / safeTotal) * 100);
                  return (
                    <Tooltip key={key}>
                      <TooltipTrigger asChild>
                        <div
                          className={cn(
                            "h-full transition-opacity hover:opacity-80",
                            CITATION_BAR_COLORS[key],
                          )}
                          style={{ width: `${widthPct}%` }}
                        />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">
                        <div className="font-semibold">{labels[key]}</div>
                        <div className="tabular-nums">{value} ({pctOfTotal}%)</div>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
