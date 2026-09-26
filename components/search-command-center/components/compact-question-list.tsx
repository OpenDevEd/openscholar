"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Pencil, Play, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useCooldown } from "@/lib/hooks/use-cooldown";
import { TooltipHint } from "@/components/ui/tooltip";

interface CompactQuestionListProps {
  questions: { question: string }[];
  onTest: (question: string) => void;
  onDelete: (index: number, question: string) => void;
  onEdit: (index: number, previousQuestion: string, nextQuestion: string) => boolean;
  disabled?: boolean;
}

export function CompactQuestionList({
  questions,
  onTest,
  onDelete,
  onEdit,
  disabled,
}: CompactQuestionListProps) {
  const t = useTranslations("emptyStates");
  const ta = useTranslations("accessibility");
  const tc = useTranslations("common");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draftQuestion, setDraftQuestion] = useState("");
  const editInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingIndex === null) return;
    if (!questions[editingIndex]) {
      setEditingIndex(null);
      setDraftQuestion("");
      return;
    }
    editInputRef.current?.focus();
    editInputRef.current?.select();
  }, [editingIndex, questions]);

  const startEdit = (index: number) => {
    setEditingIndex(index);
    setDraftQuestion(questions[index]?.question || "");
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setDraftQuestion("");
  };

  const saveEdit = (index: number) => {
    if (!questions[index]) return;
    const isSaved = onEdit(index, questions[index].question, draftQuestion);
    if (isSaved) {
      setEditingIndex(null);
      setDraftQuestion("");
    }
  };

  if (questions.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        {t("noScreeningQuestions")}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {questions.map((questionEntry, index) => (
        <div
          key={`${questionEntry.question}-${index}`}
          className="flex items-start gap-2.5 rounded-lg bg-muted/20 px-2.5 py-2"
        >
          <span
            className={cn(
              "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md",
              "bg-primary/12 text-primary",
              "text-[11px] font-mono font-semibold"
            )}
          >
            {index + 1}
          </span>

          {editingIndex === index ? (
            <Input
              ref={editInputRef}
              value={draftQuestion}
              onChange={(event) => setDraftQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  saveEdit(index);
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelEdit();
                }
              }}
              disabled={disabled}
              className="h-7 flex-1 text-sm"
            />
          ) : (
            <TooltipHint label={questionEntry.question}>
              <p className="flex-1 line-clamp-2 text-sm leading-5 text-foreground sm:line-clamp-none">
                {questionEntry.question}
              </p>
            </TooltipHint>
          )}

          <div className="flex items-center gap-1">
            {editingIndex === index ? (
              <ButtonGroup>
                <TooltipHint label={tc("save")}>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => saveEdit(index)}
                    disabled={disabled}
                    className="h-7 w-7"
                    aria-label={tc("save")}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                </TooltipHint>
                <TooltipHint label={tc("cancel")}>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={cancelEdit}
                    disabled={disabled}
                    className="h-7 w-7"
                    aria-label={tc("cancel")}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </TooltipHint>
              </ButtonGroup>
            ) : (
              <>
                <TestButton
                  question={questionEntry.question}
                  onTest={onTest}
                  disabled={disabled}
                  title={ta("testQuestion")}
                />
                <ButtonGroup>
                  <TooltipHint label={tc("edit")}>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => startEdit(index)}
                      disabled={disabled}
                      className="h-7 w-7"
                      aria-label={tc("edit")}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipHint>
                  <TooltipHint label={ta("deleteQuestion")}>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => onDelete(index, questionEntry.question)}
                      disabled={disabled}
                      className="h-7 w-7 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      aria-label={ta("deleteQuestion")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipHint>
                </ButtonGroup>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function TestButton({
  question,
  onTest,
  disabled,
  title,
}: {
  question: string;
  onTest: (question: string) => void;
  disabled?: boolean;
  title: string;
}) {
  const [isCooling, trigger] = useCooldown();

  return (
    <TooltipHint label={title}>
      <span className="inline-flex">
        <Button
          variant="ai"
          size="icon"
          onClick={() => {
            onTest(question);
            trigger();
          }}
          disabled={disabled || isCooling}
          className="h-7 w-7"
          aria-label={title}
        >
          <Play className="h-3.5 w-3.5" />
        </Button>
      </span>
    </TooltipHint>
  );
}
