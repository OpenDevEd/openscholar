"use client";

import React, { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { X, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { subtleSpring } from "@/lib/animation-config";
import {
  QUESTION_TYPES,
  DEFAULT_QUESTION_TYPE,
  QUESTION_TYPE_LABEL,
  QUESTION_TYPE_ARIA_LABEL,
  type QuestionType,
} from "@/lib/extraction/question-types";

export interface QuestionDraft {
  question: string;
  expectedType: QuestionType;
}

interface QuestionBuilderProps {
  questions: QuestionDraft[];
  onAdd: (draft: QuestionDraft) => void;
  onRemove: (index: number) => void;
  onEdit: (index: number, next: QuestionDraft) => void;
  className?: string;
}

function QuestionTypeSelect({
  value,
  onChange,
}: {
  value: QuestionType;
  onChange: (next: QuestionType) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as QuestionType)}>
      <SelectTrigger
        className="w-[110px] shrink-0 h-9"
        aria-label={QUESTION_TYPE_ARIA_LABEL}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {QUESTION_TYPES.map((type) => (
          <SelectItem key={type} value={type}>
            {QUESTION_TYPE_LABEL[type]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function QuestionBuilder({
  questions,
  onAdd,
  onRemove,
  onEdit,
  className,
}: QuestionBuilderProps) {
  const t = useTranslations("extraction");
  const [inputValue, setInputValue] = useState("");
  const [draftType, setDraftType] = useState<QuestionType>(
    DEFAULT_QUESTION_TYPE,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const prefersReducedMotion = useReducedMotion();

  const handleAdd = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    const isDuplicate = questions.some(
      (q) => q.question.toLowerCase() === trimmed.toLowerCase(),
    );
    if (isDuplicate) return;
    onAdd({ question: trimmed, expectedType: draftType });
    setInputValue("");
    setDraftType(DEFAULT_QUESTION_TYPE);
    inputRef.current?.focus();
  }, [inputValue, draftType, questions, onAdd]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAdd();
      }
    },
    [handleAdd],
  );

  const handleTextBlur = useCallback(
    (index: number, nextText: string) => {
      const trimmed = nextText.trim();
      const current = questions[index];
      if (trimmed && trimmed !== current.question) {
        onEdit(index, { ...current, question: trimmed });
      }
    },
    [questions, onEdit],
  );

  const handleTypeChange = useCallback(
    (index: number, nextType: QuestionType) => {
      const current = questions[index];
      if (nextType !== current.expectedType) {
        onEdit(index, { ...current, expectedType: nextType });
      }
    },
    [questions, onEdit],
  );

  const animationProps = prefersReducedMotion
    ? {}
    : {
        initial: { opacity: 0, height: 0 },
        animate: { opacity: 1, height: "auto" },
        exit: { opacity: 0, height: 0 },
        transition: subtleSpring,
      };

  return (
    <div className={cn("space-y-2", className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        {questions.map((draft, index) => (
          <motion.div
            key={`question-${index}-${draft.question}`}
            layout={!prefersReducedMotion}
            {...animationProps}
            className="flex items-center gap-2"
          >
            <Input
              defaultValue={draft.question}
              onBlur={(e) => handleTextBlur(index, e.target.value)}
              className="flex-1"
            />
            <QuestionTypeSelect
              value={draft.expectedType}
              onChange={(next) => handleTypeChange(index, next)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onRemove(index)}
              aria-label={`Remove question ${index + 1}`}
              className="shrink-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </motion.div>
        ))}
      </AnimatePresence>

      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("jobCreation.questionPlaceholder")}
          className="flex-1"
        />
        <QuestionTypeSelect
          value={draftType}
          onChange={setDraftType}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAdd}
          disabled={!inputValue.trim()}
          className="shrink-0 gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("jobCreation.addQuestion")}
        </Button>
      </div>
    </div>
  );
}
