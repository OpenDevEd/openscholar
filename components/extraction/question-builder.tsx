"use client";

import { useState, useRef, useEffect } from "react";
import { motion, Reorder, useDragControls } from "motion/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  GripVertical,
  Wand2,
  Loader2,
  AlignLeft,
  ToggleLeft,
  Hash,
  List,
  ClipboardList,
  ChevronDown,
  MessageSquarePlus,
} from "lucide-react";
import { useExtractionStore } from "@/lib/store/extraction";
import { useSearchHistoryStore } from "@/lib/store";
import { useGenerateExtractionQuestions } from "@/lib/ai/client/router";
import { toast } from "sonner";
import type { ExtractionQuestion, ExtractionQuestionType } from "@/lib/types";
import { cn } from "@/lib/utils";

const QUESTION_TYPES: { value: ExtractionQuestionType; label: string }[] = [
  { value: "string", label: "Text" },
  { value: "boolean", label: "Yes/No" },
  { value: "number", label: "Number" },
  { value: "array", label: "List" },
];

const TYPE_ICON_MAP: Record<
  ExtractionQuestionType,
  React.ComponentType<React.SVGProps<SVGSVGElement>>
> = {
  string: AlignLeft,
  boolean: ToggleLeft,
  number: Hash,
  array: List,
};

const TYPE_COLOR_MAP: Record<ExtractionQuestionType, string> = {
  string:
    "text-blue-600 border-blue-300 dark:text-blue-400 dark:border-blue-700",
  boolean:
    "text-emerald-600 border-emerald-300 dark:text-emerald-400 dark:border-emerald-700",
  number:
    "text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-700",
  array:
    "text-purple-600 border-purple-300 dark:text-purple-400 dark:border-purple-700",
};

interface QuestionRowProps {
  question: ExtractionQuestion;
  index: number;
  isExpanded: boolean;
  isDeleting: boolean;
  onToggleDescription: (key: string) => void;
  onUpdate: (key: string, updates: Partial<ExtractionQuestion>) => void;
  onRemove: (key: string) => void;
  onDeleteComplete: (key: string) => void;
}

function QuestionRow({
  question,
  index,
  isExpanded,
  isDeleting,
  onToggleDescription,
  onUpdate,
  onRemove,
  onDeleteComplete,
}: QuestionRowProps) {
  const dragControls = useDragControls();

  return (
    <Reorder.Item
      value={question}
      as="div"
      dragListener={false}
      dragControls={dragControls}
      layout="position"
      initial={{ opacity: 0, y: 20 }}
      animate={
        isDeleting
          ? { opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0 }
          : { opacity: 1, y: 0 }
      }
      transition={
        isDeleting
          ? {
              duration: 0.25,
              ease: [0.4, 0, 0.2, 1],
              opacity: { duration: 0.15 },
            }
          : {
              layout: { type: "spring", stiffness: 500, damping: 30 },
              type: "spring",
              stiffness: 500,
              damping: 30,
              delay: index * 0.05,
            }
      }
      onAnimationComplete={() => {
        if (isDeleting) onDeleteComplete(question.key);
      }}
      style={{
        overflow: isDeleting ? "hidden" : undefined,
        pointerEvents: isDeleting ? "none" : undefined,
      }}
      className={cn(
        "p-4 hover:bg-muted/50 transition-colors border-b border-border last:border-b-0",
        index % 2 === 0 ? "bg-background" : "bg-muted/30"
      )}
    >
      <div className="flex items-start gap-3">
        {/* Drag handle */}
        <div
          onPointerDown={(e) => dragControls.start(e)}
          className="mt-2 text-muted-foreground cursor-grab active:cursor-grabbing touch-none hover:text-foreground transition-colors"
        >
          <GripVertical className="w-5 h-5" />
        </div>

        {/* Number circle */}
        <span
          className={cn(
            "flex-shrink-0 w-6 h-6 rounded-full mt-2",
            "bg-primary/10 text-primary",
            "text-xs font-mono font-medium",
            "flex items-center justify-center"
          )}
        >
          {index + 1}
        </span>

        <div className="flex-1 space-y-2">
          {/* Input + type selector + delete — all same row, same height */}
          <div className="flex items-center gap-2">
            <Input
              value={question.question}
              onChange={(e) =>
                onUpdate(question.key, { question: e.target.value })
              }
              placeholder="Enter your question..."
              className="font-medium"
            />
            <Select
              value={question.type}
              onValueChange={(v) =>
                onUpdate(question.key, {
                  type: v as ExtractionQuestionType,
                })
              }
            >
              <SelectTrigger
                className={cn(
                  "w-auto gap-1.5 font-medium shadow-none",
                  TYPE_COLOR_MAP[question.type]
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUESTION_TYPES.map((t) => {
                  const Icon = TYPE_ICON_MAP[t.value];
                  return (
                    <SelectItem key={t.value} value={t.value}>
                      <span className="flex items-center gap-1.5">
                        <Icon className="w-3 h-3" />
                        {t.label}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <button
              onClick={() => onRemove(question.key)}
              className="flex-shrink-0 p-2 text-muted-foreground hover:text-destructive rounded-lg transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          {/* Description toggle */}
          <button
            type="button"
            onClick={() => onToggleDescription(question.key)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown
              className={cn(
                "w-3 h-3 transition-transform duration-200",
                isExpanded && "rotate-180"
              )}
            />
            {question.description ? "Edit description" : "Add description"}
          </button>

          {/* Animated description */}
          <motion.div
            initial={false}
            animate={{
              height: isExpanded ? "auto" : 0,
              opacity: isExpanded ? 1 : 0,
            }}
            transition={{
              height: { type: "spring", stiffness: 500, damping: 30 },
              opacity: { duration: 0.15 },
            }}
            className="overflow-hidden"
          >
            <Textarea
              value={question.description || ""}
              onChange={(e) =>
                onUpdate(question.key, { description: e.target.value })
              }
              placeholder="Additional context for the AI (optional)..."
              className="text-sm"
              rows={2}
            />
          </motion.div>
        </div>
      </div>
    </Reorder.Item>
  );
}

export function QuestionBuilder() {
  const {
    draftJob,
    addQuestion,
    removeQuestion,
    updateQuestion,
    reorderQuestions,
  } = useExtractionStore();
  const [newQuestion, setNewQuestion] = useState({
    question: "",
    type: "string" as ExtractionQuestionType,
    description: "",
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [expandedDescriptions, setExpandedDescriptions] = useState<Set<string>>(
    new Set()
  );
  const [deletingKeys, setDeletingKeys] = useState<Set<string>>(new Set());
  const [newDescriptionOpen, setNewDescriptionOpen] = useState(false);
  const questionInputRef = useRef<HTMLInputElement>(null);
  const { execute: generateQuestions, isConfigured } =
    useGenerateExtractionQuestions();
  const searchHistory = useSearchHistoryStore((state) => state.searchHistory);

  // Auto-expand questions that already have descriptions
  useEffect(() => {
    const withDescriptions = draftJob.questions
      .filter((q) => q.description)
      .map((q) => q.key);
    if (withDescriptions.length > 0) {
      setExpandedDescriptions((prev) => {
        const next = new Set(prev);
        for (const key of withDescriptions) {
          next.add(key);
        }
        return next;
      });
    }
  }, [draftJob.questions]);

  const toggleDescription = (key: string) => {
    setExpandedDescriptions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleDelete = (key: string) => {
    setDeletingKeys((prev) => new Set(prev).add(key));
  };

  const handleDeleteComplete = (key: string) => {
    removeQuestion(key);
    setDeletingKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  const handleReorder = (newOrder: ExtractionQuestion[]) => {
    const oldOrder = draftJob.questions;
    for (let i = 0; i < oldOrder.length; i++) {
      if (oldOrder[i].key !== newOrder[i].key) {
        const newIndex = newOrder.findIndex((q) => q.key === oldOrder[i].key);
        reorderQuestions(i, newIndex);
        return;
      }
    }
  };

  const buildSourceContext = (): string => {
    const parts: string[] = [];

    const historyEntries = draftJob.selectedHistoryIds
      .map((id) => searchHistory.find((h) => h.id === id))
      .filter(Boolean);
    if (historyEntries.length > 0) {
      parts.push(
        "Search queries:\n" +
          historyEntries.map((e) => `- "${e!.query}"`).join("\n")
      );
    }

    const zoteroItems = draftJob.zoteroSelection?.items || [];
    if (zoteroItems.length > 0) {
      const snippets = zoteroItems.slice(0, 10).map((item) => {
        const abstract = item.abstract
          ? item.abstract.slice(0, 200) +
            (item.abstract.length > 200 ? "..." : "")
          : "";
        return `- "${item.title}"${abstract ? `\n  Abstract: ${abstract}` : ""}`;
      });
      parts.push("Zotero papers:\n" + snippets.join("\n"));
    }

    if (draftJob.manualItems.length > 0) {
      const snippets = draftJob.manualItems.slice(0, 10).map((item) => {
        const abstract = item.abstract
          ? item.abstract.slice(0, 200) +
            (item.abstract.length > 200 ? "..." : "")
          : "";
        return `- "${item.title}"${abstract ? `\n  Abstract: ${abstract}` : ""}`;
      });
      parts.push("Manual papers:\n" + snippets.join("\n"));
    }

    return parts.join("\n\n");
  };

  const handleGenerateWithAI = async () => {
    if (!isConfigured) {
      toast.error("AI Not Configured", {
        description: "Please configure your AI API key first.",
        action: {
          label: "Configure",
          onClick: () => (window.location.href = "/settings/ai"),
        },
      });
      return;
    }

    const sourceContext = buildSourceContext();
    if (!sourceContext) {
      toast.error("No source context", {
        description: "Please select sources in Step 2 first.",
      });
      return;
    }

    setIsGenerating(true);
    try {
      const result = await generateQuestions({
        jobName: draftJob.name,
        sourceContext,
        existingQuestions: draftJob.questions.map((q) => q.question),
      });

      let addedCount = 0;
      for (const q of result.questions) {
        const normalizedNew = q.question.toLowerCase().trim();
        const isDuplicate = draftJob.questions.some((existing) => {
          const normalizedExisting = existing.question.toLowerCase().trim();
          return (
            normalizedExisting === normalizedNew ||
            normalizedExisting.includes(normalizedNew) ||
            normalizedNew.includes(normalizedExisting)
          );
        });
        if (!isDuplicate) {
          addQuestion({
            question: q.question,
            type: q.type,
            description: q.description,
          });
          addedCount++;
        }
      }

      if (addedCount > 0) {
        toast.success(
          `Added ${addedCount} new question${addedCount > 1 ? "s" : ""}`
        );
      } else {
        toast.warning("No new questions generated");
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to generate questions";
      if (message === "API_KEY_REQUIRED") {
        toast.error("API Key Required", {
          description: "Please configure your AI API key.",
          action: {
            label: "Configure",
            onClick: () => (window.location.href = "/settings/ai"),
          },
        });
      } else {
        toast.error("Generation failed", { description: message });
      }
    } finally {
      setIsGenerating(false);
    }
  };

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
    setNewDescriptionOpen(false);

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

  const questionCount = draftJob.questions.length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <ClipboardList className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground">
          Questions
        </span>
        <Badge variant="secondary">{questionCount}</Badge>
      </div>

      {/* List or Empty State */}
      {questionCount === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 px-6 border-2 border-dashed border-border rounded-xl">
          <div className="rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 p-4 mb-4">
            <MessageSquarePlus className="w-8 h-8 text-primary" />
          </div>
          <h3 className="text-base font-semibold text-foreground mb-1">
            No questions defined
          </h3>
          <p className="text-sm text-muted-foreground mb-1">
            Define what data to extract from each paper.
          </p>
          <p className="text-xs text-muted-foreground/70">
            Add questions manually below, or use AI to generate them from your
            sources.
          </p>
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <Reorder.Group
            axis="y"
            values={draftJob.questions}
            onReorder={handleReorder}
            as="div"
          >
            {draftJob.questions.map((q, index) => (
              <QuestionRow
                key={q.key}
                question={q}
                index={index}
                isExpanded={expandedDescriptions.has(q.key)}
                isDeleting={deletingKeys.has(q.key)}
                onToggleDescription={toggleDescription}
                onUpdate={updateQuestion}
                onRemove={handleDelete}
                onDeleteComplete={handleDeleteComplete}
              />
            ))}
          </Reorder.Group>
        </div>
      )}

      {/* Add New Question */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-muted rounded-xl p-5 border border-border"
      >
        <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Plus className="w-4 h-4 text-primary" />
          Add New Question
        </h4>

        <form onSubmit={handleAdd} className="space-y-3">
          <Input
            ref={questionInputRef}
            value={newQuestion.question}
            onChange={(e) =>
              setNewQuestion({ ...newQuestion, question: e.target.value })
            }
            placeholder="e.g., What is the sample size?"
          />

          {/* Collapsible description */}
          <div>
            <button
              type="button"
              onClick={() => setNewDescriptionOpen((o) => !o)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronDown
                className={cn(
                  "w-3 h-3 transition-transform duration-200",
                  newDescriptionOpen && "rotate-180"
                )}
              />
              {newQuestion.description
                ? "Edit description"
                : "Add description"}
            </button>
            <motion.div
              initial={false}
              animate={{
                height: newDescriptionOpen ? "auto" : 0,
                opacity: newDescriptionOpen ? 1 : 0,
              }}
              transition={{
                height: { type: "spring", stiffness: 500, damping: 30 },
                opacity: { duration: 0.15 },
              }}
              className="overflow-hidden"
            >
              <Textarea
                value={newQuestion.description}
                onChange={(e) =>
                  setNewQuestion({
                    ...newQuestion,
                    description: e.target.value,
                  })
                }
                onKeyDown={handleKeyDown}
                placeholder="Additional context for the AI... (Ctrl+Enter to add)"
                className="text-sm mt-2"
                rows={2}
              />
            </motion.div>
          </div>

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
                {QUESTION_TYPES.map((t) => {
                  const Icon = TYPE_ICON_MAP[t.value];
                  return (
                    <SelectItem key={t.value} value={t.value}>
                      <span className="flex items-center gap-1.5">
                        <Icon className="w-3 h-3" />
                        {t.label}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>

            <Button
              type="submit"
              disabled={!newQuestion.question.trim()}
            >
              <Plus className="w-4 h-4 mr-1" />
              Add
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={handleGenerateWithAI}
              disabled={isGenerating}
              className={cn(
                "gap-1.5",
                "bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10",
                "hover:from-violet-500/20 hover:to-fuchsia-500/20",
                "border-violet-500/30 hover:border-violet-500/50",
                "text-violet-700 dark:text-violet-300",
                "transition-all duration-200"
              )}
            >
              {isGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Wand2 className="h-4 w-4" />
                  Generate with AI
                </>
              )}
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
