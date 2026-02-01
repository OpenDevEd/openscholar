"use client";

import { useState } from "react";
import { motion } from "motion/react";
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
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { useExtractionStore } from "@/lib/store/extraction";
import type { ExtractionQuestionType } from "@/lib/types";

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

  const handleAdd = () => {
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
  };

  return (
    <div className="space-y-6">
      {/* Existing Questions */}
      <div className="space-y-3">
        {draftJob.questions.map((q, index) => (
          <motion.div
            key={q.key}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <Card>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <GripVertical className="w-5 h-5 text-muted-foreground mt-2" />
                  <div className="flex-1 space-y-3">
                    <Input
                      value={q.question}
                      onChange={(e) =>
                        updateQuestion(q.key, { question: e.target.value })
                      }
                      placeholder="Enter your question..."
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
                    <div className="flex items-center gap-2">
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
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeQuestion(q.key)}
                    className="text-destructive"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Add New Question */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="space-y-2">
            <Label>Add New Question</Label>
            <Input
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
            placeholder="Additional context for the AI..."
            className="text-sm"
            rows={2}
          />

          <div className="flex gap-2">
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
              onClick={handleAdd}
              disabled={!newQuestion.question.trim()}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Question
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
