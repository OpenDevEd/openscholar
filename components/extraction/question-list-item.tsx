"use client";

import { useTranslations } from "next-intl";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  statusFromCompletion,
  getAnswerPercentage,
  STATUS_DOT_CLASSES,
  STATUS_DOT_LABELS,
} from "@/lib/extraction/question-status";

interface QuestionListItemProps {
  questionKey: string;
  question: string;
  answered: number;
  total: number;
  isSelected?: boolean;
  onClick?: () => void;
}

export function QuestionListItem({
  question,
  answered,
  total,
  isSelected = false,
  onClick,
}: QuestionListItemProps) {
  const t = useTranslations("extraction");
  const status = statusFromCompletion(answered, total);
  const percentage = getAnswerPercentage(answered, total);

  return (
    <button
      type="button"
      aria-pressed={isSelected}
      className={cn(
        "w-full px-5 py-3.5 text-left transition-all flex items-center gap-3.5 group",
        isSelected
          ? "bg-primary/[0.06] dark:bg-primary/[0.12] border-l-2 border-l-primary"
          : "hover:bg-muted/40 dark:hover:bg-muted/20 border-l-2 border-l-transparent",
      )}
      onClick={onClick}
    >
      <div
        data-status={status}
        className={cn("w-2.5 h-2.5 rounded-full shrink-0 ring-2 ring-background shadow-sm", STATUS_DOT_CLASSES[status])}
        aria-hidden="true"
      />
      <span className="sr-only">{(t as any)(STATUS_DOT_LABELS[status])}</span>
      <div className={cn(
        "flex-1 min-w-0 text-sm transition-colors",
        isSelected ? "font-semibold text-foreground" : "font-medium text-foreground/80 group-hover:text-foreground",
      )}>
        {question}
      </div>
      <div className="flex items-center gap-3 shrink-0 w-32 sm:w-44">
        <Progress
          value={percentage}
          aria-valuenow={answered}
          aria-valuemin={0}
          aria-valuemax={Math.max(total, 1)}
          aria-label={`Answer coverage: ${percentage}%`}
          className="flex-1 h-1.5"
        />
        <span className={cn(
          "text-xs font-mono tabular-nums w-10 text-right transition-colors",
          isSelected ? "text-foreground font-semibold" : "text-muted-foreground",
        )}>
          {percentage}%
        </span>
      </div>
    </button>
  );
}
