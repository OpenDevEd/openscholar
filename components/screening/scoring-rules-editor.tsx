"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Asterisk, Check, MoreVertical, Pencil, Plus, Trash2, X } from "@/components/icons";
import type { ScoringRule } from "@/convex/screening/scoring";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// A "required" question scores No and N/A this low so any non-Yes answer sinks
// the paper below any star threshold. Both being this value === required.
const REQUIRED_SCORE = -1000;

interface ScoringRulesEditorProps {
  questions: { key: string; question: string }[];
  rules: ScoringRule[];
  onChange: (rules: ScoringRule[]) => void;
  minimumScore: number | undefined;
  onMinimumScoreChange: (score: number | undefined) => void;
  onAddQuestion?: (question: string) => void;
  onRemoveQuestion?: (index: number) => void;
  onEditQuestion?: (index: number, newQuestion: string) => void;
  disabled?: boolean;
}

export function ScoringRulesEditor({
  questions,
  rules,
  onChange,
  minimumScore,
  onMinimumScoreChange,
  onAddQuestion,
  onRemoveQuestion,
  onEditQuestion,
  disabled,
}: ScoringRulesEditorProps) {
  const t = useTranslations("screeningDialog");
  const tc = useTranslations("common");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [newQuestion, setNewQuestion] = useState("");
  const editRef = useRef<HTMLInputElement>(null);

  function handlePointChange(
    questionKey: string,
    field: "yesPoints" | "noPoints" | "nullPoints",
    value: number
  ) {
    const updated = rules.map((rule) =>
      rule.questionKey === questionKey ? { ...rule, [field]: value } : rule
    );
    onChange(updated);
  }

  // A "required" question disqualifies any non-Yes answer — done bluntly by
  // scoring both No and N/A as -1000 (those inputs are then hidden). One onChange
  // sets both, so there's no stale-state clobber.
  function setRequired(questionKey: string, required: boolean) {
    const value = required ? REQUIRED_SCORE : 0;
    onChange(
      rules.map((rule) =>
        rule.questionKey === questionKey
          ? { ...rule, noPoints: value, nullPoints: value }
          : rule,
      ),
    );
  }

  function startEdit(index: number) {
    setEditingIndex(index);
    setDraft(questions[index]?.question || "");
    setTimeout(() => editRef.current?.focus(), 0);
  }

  function saveEdit(index: number) {
    const trimmed = draft.trim();
    if (!trimmed || !onEditQuestion) return;
    onEditQuestion(index, trimmed);
    setEditingIndex(null);
    setDraft("");
  }

  function cancelEdit() {
    setEditingIndex(null);
    setDraft("");
  }

  function handleAdd() {
    const trimmed = newQuestion.trim();
    if (!trimmed || !onAddQuestion) return;
    onAddQuestion(trimmed);
    setNewQuestion("");
  }

  const canManage = !!(onAddQuestion && onRemoveQuestion && onEditQuestion);

  return (
    <div className="space-y-3">
      {/* Table-like container */}
      <div className="rounded-lg border border-border-subtle bg-card">
        {/* Column headers */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-subtle">
          <div className="flex-1" />
          <div className="flex items-center gap-1.5">
            <span className="w-16 text-center text-xs font-medium text-muted-foreground">
              {t("yesLabel")}
            </span>
            <span className="w-16 text-center text-xs font-medium text-muted-foreground">
              {t("noLabel")}
            </span>
            <span className="w-16 text-center text-xs font-medium text-muted-foreground">
              {t("uncertainLabel")}
            </span>
            {canManage && <span className="w-14" />}
          </div>
        </div>

        {/* Question rows */}
        {questions.map((q, i) => {
          const rule = rules.find((r) => r.questionKey === q.key);
          if (!rule) return null;
          const isEditing = editingIndex === i;
          const isRequired =
            rule.noPoints === REQUIRED_SCORE && rule.nullPoints === REQUIRED_SCORE;

          return (
            <div
              key={q.key}
              className={`flex items-start gap-2 px-3 py-2 ${
                i < questions.length - 1 ? "border-b border-border-subtle" : ""
              }`}
            >
              {/* Numbered question */}
              <div className="flex flex-1 items-start gap-2 min-w-0">
                <span className="mt-0.5 shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">
                  {i + 1}.
                </span>
                {isEditing ? (
                  <Input
                    ref={editRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); saveEdit(i); }
                      if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
                    }}
                    className="h-7 flex-1 text-sm"
                    disabled={disabled}
                  />
                ) : (
                  <span className="min-w-0 flex-1 text-sm leading-5 text-foreground/90">
                    {q.question}
                  </span>
                )}
              </div>

              {/* Point inputs */}
              <div className="flex items-center gap-1.5 shrink-0">
                <Input
                  type="number"
                  value={rule.yesPoints}
                  onChange={(e) =>
                    handlePointChange(q.key, "yesPoints", Number(e.target.value))
                  }
                  disabled={disabled}
                  className="h-7 w-16 text-center"
                />
                <Input
                  type="number"
                  value={rule.noPoints}
                  onChange={(e) =>
                    handlePointChange(q.key, "noPoints", Number(e.target.value))
                  }
                  disabled={disabled}
                  className={`h-7 w-16 text-center ${isRequired ? "invisible" : ""}`}
                />
                <Input
                  type="number"
                  value={rule.nullPoints}
                  onChange={(e) =>
                    handlePointChange(q.key, "nullPoints", Number(e.target.value))
                  }
                  disabled={disabled}
                  className={`h-7 w-16 text-center ${isRequired ? "invisible" : ""}`}
                />

                {/* Edit/Delete actions — collapsed into a kebab menu to free row space */}
                {canManage && (
                  <div className="flex shrink-0 items-center gap-0.5 justify-end">
                    {isEditing ? (
                      <>
                        <Button variant="ghost" size="icon" onClick={() => saveEdit(i)} disabled={disabled} className="h-7 w-7">
                          <Check className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={cancelEdit} className="h-7 w-7">
                          <X className="h-3 w-3" />
                        </Button>
                      </>
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={disabled}
                            aria-label={tc("more")}
                            className="h-7 w-7 text-muted-foreground"
                          >
                            <MoreVertical className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => startEdit(i)}>
                            <Pencil className="mr-2 h-3.5 w-3.5" />
                            {tc("edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setRequired(q.key, !isRequired)}>
                            <Asterisk className="mr-2 h-3.5 w-3.5" />
                            {isRequired ? t("makeOptional") : t("makeRequired")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => onRemoveQuestion(i)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="mr-2 h-3.5 w-3.5" />
                            {tc("delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Empty state */}
        {questions.length === 0 && (
          <div className="px-3 py-4 text-center text-sm text-muted-foreground">
            {t("noQuestions")}
          </div>
        )}
      </div>

      {/* Add question input */}
      {canManage && (
        <div className="flex items-center gap-2">
          <Input
            value={newQuestion}
            onChange={(e) => setNewQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); handleAdd(); }
            }}
            placeholder={tc("addQuestion")}
            disabled={disabled}
            className="h-8 flex-1 text-sm"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleAdd}
            disabled={disabled || !newQuestion.trim()}
            className="h-8 gap-1.5 shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            {tc("add")}
          </Button>
        </div>
      )}

      {/* Minimum score */}
      <div className="flex items-center gap-3 rounded-lg bg-inset px-3 py-2">
        <Label className="text-xs font-medium text-muted-foreground whitespace-nowrap">
          {t("minimumScoreLabel")}
        </Label>
        <Input
          type="number"
          value={minimumScore ?? ""}
          placeholder="--"
          onChange={(e) => {
            const val = e.target.value;
            onMinimumScoreChange(val === "" ? undefined : Number(val));
          }}
          disabled={disabled}
          className="h-7 w-20"
        />
      </div>
    </div>
  );
}
