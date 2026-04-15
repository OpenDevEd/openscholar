"use client";

import React, { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { X, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { subtleSpring } from "@/lib/animation-config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QuestionBuilderProps {
  questions: string[];
  onAdd: (question: string) => void;
  onRemove: (index: number) => void;
  onEdit: (index: number, newQuestion: string) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function QuestionBuilder({
  questions,
  onAdd,
  onRemove,
  onEdit,
  className,
}: QuestionBuilderProps) {
  const t = useTranslations("extraction");
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const prefersReducedMotion = useReducedMotion();

  const handleAdd = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    // Duplicate prevention (case-insensitive)
    const isDuplicate = questions.some(
      (q) => q.toLowerCase() === trimmed.toLowerCase()
    );
    if (isDuplicate) return;
    onAdd(trimmed);
    setInputValue("");
    inputRef.current?.focus();
  }, [inputValue, questions, onAdd]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAdd();
      }
    },
    [handleAdd]
  );

  const handleEditBlur = useCallback(
    (index: number, newValue: string) => {
      const trimmed = newValue.trim();
      if (trimmed && trimmed !== questions[index]) {
        onEdit(index, trimmed);
      }
    },
    [questions, onEdit]
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
      {/* Existing question list */}
      <AnimatePresence mode="popLayout" initial={false}>
        {questions.map((question, index) => (
          <motion.div
            key={`question-${index}-${question}`}
            layout={!prefersReducedMotion}
            {...animationProps}
            className="flex items-center gap-2"
          >
            <Input
              defaultValue={question}
              onBlur={(e) => handleEditBlur(index, e.target.value)}
              className="flex-1"
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

      {/* Add question row */}
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("jobCreation.questionPlaceholder")}
          className="flex-1"
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
