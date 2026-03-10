"use client";

import { useTranslations } from "next-intl";
import { Progress } from "@/components/ui/progress";
import {
  statusFromCompletion,
  getAnswerPercentage,
  STATUS_DOT_COLORS,
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
      className={`w-full px-4 py-3 text-left hover:bg-muted/20 transition-colors flex items-center gap-3 ${
        isSelected ? "bg-primary/5" : ""
      }`}
      onClick={onClick}
    >
      <div
        className="w-3 h-3 rounded-full shrink-0"
        style={{ backgroundColor: STATUS_DOT_COLORS[status] }}
        title={t(STATUS_DOT_LABELS[status])}
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0 font-medium">{question}</div>
      <div className="flex items-center gap-2 shrink-0 w-40">
        <Progress
          value={percentage}
          aria-valuenow={answered}
          aria-valuemin={0}
          aria-valuemax={Math.max(total, 1)}
          aria-label={`Answer coverage: ${percentage}%`}
          className="flex-1"
        />
        <span className="text-xs font-mono text-muted-foreground w-10 text-right">
          {percentage}%
        </span>
      </div>
    </button>
  );
}
