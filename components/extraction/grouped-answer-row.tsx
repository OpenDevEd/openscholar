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
  const t = useTranslations("extraction");
  const [isExpanded, setIsExpanded] = useState(false);

  const hasVariants = group.variants.length > 1;

  return (
    <div className="space-y-1">
      {/* Main row */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{group.groupRepresentative}</span>
        {hasVariants && (
          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            aria-label={t("answerGroupingExpand", { count: group.variants.length })}
          >
            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span>{t("answerGroupingExpand", { count: group.variants.length })}</span>
          </button>
        )}
      </div>

      {/* Expanded variant sub-rows */}
      {isExpanded && hasVariants && (
        <div className="ml-4 border-l-2 border-muted pl-3 space-y-0.5">
          {group.variants.map((variant, idx) => (
            <div
              key={`${variant.normalized}-${idx}`}
              className="text-xs text-muted-foreground flex items-center gap-2"
            >
              <span>{variant.display}</span>
              <span className="font-mono">×{variant.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
