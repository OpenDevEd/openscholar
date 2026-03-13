"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight } from "lucide-react";

interface GroupedAnswerVariant {
  display: string;
  normalized: string;
  count: number;
  citationStatusMix: {
    grounded: number;
    best_effort: number;
    insufficient_evidence: number;
    extraction_error: number;
  };
}

interface GroupedAnswer {
  groupRepresentative: string;
  groupNormalized: string;
  count: number;
  citationStatusMix: {
    grounded: number;
    best_effort: number;
    insufficient_evidence: number;
    extraction_error: number;
  };
  variants: GroupedAnswerVariant[];
}

export interface GroupedAnswerRowProps {
  group: GroupedAnswer;
}

export function GroupedAnswerRow({ group }: GroupedAnswerRowProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t: any = useTranslations("extraction");
  const [isExpanded, setIsExpanded] = useState(false);

  const hasVariants = group.variants.length > 1;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2.5">
        <span className="text-sm font-medium text-foreground">{group.groupRepresentative}</span>
        {hasVariants && (
          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-md px-2 py-1.5 min-h-[36px] hover:bg-muted/50"
            aria-label={t("answerGroupingExpand", { count: group.variants.length })}
            aria-expanded={isExpanded}
          >
            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span>{t("answerGroupingExpand", { count: group.variants.length })}</span>
          </button>
        )}
      </div>

      {isExpanded && hasVariants && (
        <div className="ml-5 border-l-2 border-border/60 dark:border-border/40 pl-3.5 space-y-1 py-1">
          {group.variants.map((variant, idx) => (
            <div
              key={`${variant.normalized}-${idx}`}
              className="text-xs text-muted-foreground flex items-center gap-2 py-0.5"
            >
              <span className="text-foreground/70">{variant.display}</span>
              <span className="font-mono tabular-nums text-muted-foreground/70 bg-muted/40 dark:bg-muted/20 rounded px-1.5 py-0.5 text-xs">
                {variant.count}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
