"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { X, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CompactQuestionListProps {
  questions: { question: string }[];
  onTest: (question: string) => void;
  onDelete: (index: number, question: string) => void;
  disabled?: boolean;
}

export function CompactQuestionList({
  questions,
  onTest,
  onDelete,
  disabled,
}: CompactQuestionListProps) {
  const t = useTranslations("emptyStates");
  const ta = useTranslations("accessibility");

  if (questions.length === 0) {
    return (
      <div className="py-6 text-center text-muted-foreground">
        <p className="text-sm">{t("noScreeningQuestions")}</p>
        <p className="text-xs mt-1">{t("addQuestionsAbove")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {questions.map((q, index) => (
        <div
          key={q.question}
          className={cn(
            "group flex items-center gap-2 px-3 py-2 rounded-lg",
            "hover:bg-muted/50 transition-colors"
          )}
        >
          {/* Question number */}
          <span
            className={cn(
              "flex-shrink-0 w-5 h-5 rounded-full",
              "bg-primary/10 text-primary",
              "text-xs font-mono font-medium",
              "flex items-center justify-center"
            )}
          >
            {index + 1}
          </span>

          {/* Question text */}
          <span className="flex-1 text-sm truncate">{q.question}</span>

          {/* Action buttons (visible on hover) */}
          <div
            className={cn(
              "flex-shrink-0 flex items-center gap-1",
              "opacity-0 group-hover:opacity-100 transition-opacity"
            )}
          >
            <Button
              variant="ai"
              size="icon"
              onClick={() => onTest(q.question)}
              disabled={disabled}
              className="h-7 w-7"
              title={ta("testQuestion")}
            >
              <Play className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onDelete(index, q.question)}
              disabled={disabled}
              className="h-7 w-7 text-destructive hover:text-destructive"
              title={ta("deleteQuestion")}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
