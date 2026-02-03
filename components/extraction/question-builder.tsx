"use client";

import { useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { useExtractionStore } from "@/lib/store/extraction";
import type { ExtractionQuestionType } from "@/lib/types";
import { cn } from "@/lib/utils";

const QUESTION_TYPES: { value: ExtractionQuestionType; label: string }[] = [
  { value: "string", label: "Text" },
  { value: "boolean", label: "Yes/No" },
  { value: "number", label: "Number" },
  { value: "array", label: "List" },
];

export function QuestionBuilder() {
  const { draftJob, addQuestion, removeQuestion, updateQuestion } =
    useExtractionStore();
  const [newQuestion, setNewQuestion] = useState({
    question: "",
    type: "string" as ExtractionQuestionType,
    description: "",
  });
  const questionInputRef = useRef<HTMLInputElement>(null);

  const handleAdd = (e?: React.FormEvent) => {
    e?.preventDefault();
    
    if (!newQuestion.question.trim()) return;

    addQuestion({
      question: newQuestion.question,
      type: newQuestion.type,
      description: newQuestion.description || undefined,
    });

    setNewQuestion({
      question: "",
      type: "string",
      description: "",
    });

    // Refocus on the question input after adding
    setTimeout(() => {
      questionInputRef.current?.focus();
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Allow Ctrl+Enter or Cmd+Enter to submit from description textarea
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      handleAdd();
    }
  };

  return (
    <div className="space-y-6">
      {/* Existing Questions - List Layout */}
      <div className="space-y-0 divide-y divide-border border border-border rounded-xl overflow-hidden">
        <AnimatePresence mode="popLayout">
          {draftJob.questions.map((q, index) => (
            <motion.div
              key={q.key}
              layout
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, x: -50 }}
              transition={{
                type: "spring",
                stiffness: 500,
                damping: 30,
                delay: index * 0.05,
              }}
              className={cn(
                "p-4 hover:bg-muted/50 transition-colors",
                index % 2 === 0 ? "bg-background" : "bg-muted/30"
              )}
            >
              <div className="flex items-start gap-4">
                <motion.div
                  whileHover={{ scale: 1.1 }}
                  className="mt-2 text-muted-foreground cursor-grab"
                >
                  <GripVertical className="w-5 h-5" />
                </motion.div>

                <div className="flex-1 space-y-3">
                  <Input
                    value={q.question}
                    onChange={(e) =>
                      updateQuestion(q.key, { question: e.target.value })
                    }
                    placeholder="Enter your question..."
                    className="font-medium"
                  />
                  <Textarea
                    value={q.description || ""}
                    onChange={(e) =>
                      updateQuestion(q.key, { description: e.target.value })
                    }
                    placeholder="Additional context for the AI (optional)..."
                    className="text-sm"
                    rows={2}
                  />
                  <div className="flex items-center gap-3">
                    <Select
                      value={q.type}
                      onValueChange={(v) =>
                        updateQuestion(q.key, {
                          type: v as ExtractionQuestionType,
                        })
                      }
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {QUESTION_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-sm text-muted-foreground">
                      {
                        QUESTION_TYPES.find((t) => t.value === q.type)?.label
                      }
                    </span>
                  </div>
                </div>

                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => removeQuestion(q.key)}
                  className="p-2 text-muted-foreground hover:text-destructive rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </motion.button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Add New Question */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-muted rounded-xl p-6 border border-border"
      >
        <h4 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <Plus className="w-4 h-4 text-primary" />
          Add New Question
        </h4>

        <form onSubmit={handleAdd} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="question-input">Question</Label>
            <Input
              id="question-input"
              ref={questionInputRef}
              value={newQuestion.question}
              onChange={(e) =>
                setNewQuestion({ ...newQuestion, question: e.target.value })
              }
              placeholder="e.g., What is the sample size?"
            />
          </div>

          <Textarea
            value={newQuestion.description}
            onChange={(e) =>
              setNewQuestion({ ...newQuestion, description: e.target.value })
            }
            onKeyDown={handleKeyDown}
            placeholder="Additional context for the AI... (Ctrl+Enter to add)"
            className="text-sm"
            rows={2}
          />

          <div className="flex gap-3">
            <Select
              value={newQuestion.type}
              onValueChange={(v) =>
                setNewQuestion({
                  ...newQuestion,
                  type: v as ExtractionQuestionType,
                })
              }
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                {QUESTION_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              type="submit"
              disabled={!newQuestion.question.trim()}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Question
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
