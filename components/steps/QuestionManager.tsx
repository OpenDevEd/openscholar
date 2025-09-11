"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Edit3, Trash2, Plus, HelpCircle } from "lucide-react";
import { motion } from "motion/react";
import type { ScreeningQuestion, ScreeningQuestionType } from "@/lib/store";

// Generic question item type that can handle both string and ScreeningQuestion
type QuestionItem = string | ScreeningQuestion;

interface QuestionManagerProps {
  questions: QuestionItem[];
  onAddQuestion: (question: string, type?: ScreeningQuestionType) => void;
  onEditQuestion: (index: number, question: string, type?: ScreeningQuestionType) => void;
  onRemoveQuestion: (index: number) => void;
  customQuestionType?: ScreeningQuestionType;
  onCustomQuestionTypeChange?: (type: ScreeningQuestionType) => void;
  placeholder?: string;
  addButtonText?: string;
  showQuestionTypes?: boolean;
  renderQuestionContent?: (question: QuestionItem, index: number, isEditing: boolean) => React.ReactNode;
  getQuestionIcon?: (question: QuestionItem) => React.ReactElement;
}

export function QuestionManager({
  questions,
  onAddQuestion,
  onEditQuestion,
  onRemoveQuestion,
  customQuestionType = "boolean",
  onCustomQuestionTypeChange,
  placeholder = "Enter a custom question...",
  addButtonText = "Add Question",
  showQuestionTypes = false,
  renderQuestionContent,
  getQuestionIcon
}: QuestionManagerProps) {
  const [customQuestion, setCustomQuestion] = useState("");
  const [editingQuestionIndex, setEditingQuestionIndex] = useState<number | null>(null);
  const [editingQuestionText, setEditingQuestionText] = useState("");
  const [editingQuestionType, setEditingQuestionType] = useState<ScreeningQuestionType>("boolean");

  const handleAddCustomQuestion = () => {
    if (customQuestion.trim()) {
      onAddQuestion(customQuestion.trim(), customQuestionType);
      setCustomQuestion("");
    }
  };

  const startEditingQuestion = (index: number) => {
    const question = questions[index];
    setEditingQuestionIndex(index);
    if (typeof question === "string") {
      setEditingQuestionText(question);
      setEditingQuestionType("boolean");
    } else {
      setEditingQuestionText(question.question);
      setEditingQuestionType(question.type);
    }
  };

  const saveEditedQuestion = () => {
    if (editingQuestionIndex !== null && editingQuestionText.trim()) {
      onEditQuestion(editingQuestionIndex, editingQuestionText.trim(), editingQuestionType);
      setEditingQuestionIndex(null);
      setEditingQuestionText("");
      setEditingQuestionType("boolean");
    }
  };

  const cancelEditingQuestion = () => {
    setEditingQuestionIndex(null);
    setEditingQuestionText("");
    setEditingQuestionType("boolean");
  };

  const getTypeIcon = (type: ScreeningQuestionType) => {
    switch (type) {
      case 'boolean':
        return <div className="h-3 w-3 rounded-full bg-green-500" />;
      case 'number':
        return <div className="h-3 w-3 rounded-full bg-blue-500" />;
      case 'string':
        return <div className="h-3 w-3 rounded-full bg-purple-500" />;
      case 'array':
        return <div className="h-3 w-3 rounded-full bg-orange-500" />;
      default:
        return <HelpCircle className="h-3 w-3" />;
    }
  };

  const getTypeLabel = (type: ScreeningQuestionType) => {
    switch (type) {
      case 'boolean':
        return 'Yes/No';
      case 'number':
        return 'Number';
      case 'string':
        return 'Text';
      case 'array':
        return 'Multiple';
      default:
        return 'Unknown';
    }
  };

  const getTypeColor = (type: ScreeningQuestionType) => {
    switch (type) {
      case 'boolean':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400';
      case 'number':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400';
      case 'string':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-400';
      case 'array':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-400';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400';
    }
  };

  return (
    <div className="space-y-4">
      {questions.map((question, index) => (
        <motion.div
          key={typeof question === "string" ? `${question}_${index}` : question.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.3,
            delay: index * 0.05,
            ease: "easeOut"
          }}
          className="group relative border border-border/50 transition-all rounded-lg bg-muted/20 hover:bg-muted/40"
        >
          {/* Question Header */}
          <div className="flex items-center justify-between p-3 pb-2">
            <div className="flex items-center gap-3">
              <div className="p-1 rounded-full bg-purple-100 dark:bg-purple-900/20">
                {getQuestionIcon ? getQuestionIcon(question) : <HelpCircle className="h-3 w-3 text-purple-600 dark:text-purple-400" />}
              </div>
              <Badge variant="outline" className="text-xs">
                Question #{index + 1}
              </Badge>
              {typeof question !== "string" && showQuestionTypes && (
                <Badge className={`text-xs ${getTypeColor(question.type)}`}>
                  {getTypeLabel(question.type)}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => startEditingQuestion(index)}
                className="h-7 w-7 p-0"
              >
                <Edit3 className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRemoveQuestion(index)}
                className="h-7 w-7 p-0 text-red-600 hover:text-red-700 hover:bg-red-100/50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-900/20"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          {/* Question Content */}
          <div className="px-3 pb-3">
            {editingQuestionIndex === index ? (
              <div className="space-y-2">
                <Textarea
                  value={editingQuestionText}
                  onChange={(e) => setEditingQuestionText(e.target.value)}
                  className="min-h-[60px] resize-none"
                  placeholder="Enter your question..."
                />
                {showQuestionTypes && (
                  <Select
                    value={editingQuestionType}
                    onValueChange={(value) => setEditingQuestionType(value as ScreeningQuestionType)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="boolean">Boolean (Yes/No)</SelectItem>
                      <SelectItem value="string">String (Text)</SelectItem>
                      <SelectItem value="number">Number</SelectItem>
                      <SelectItem value="array">Array (Multiple values)</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveEditedQuestion}>
                    Save
                  </Button>
                  <Button size="sm" variant="outline" onClick={cancelEditingQuestion}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              renderQuestionContent ? (
                renderQuestionContent(question, index, false)
              ) : (
                <p className="text-sm leading-relaxed text-foreground font-medium">
                  {typeof question === "string" ? question : question.question}
                </p>
              )
            )}
          </div>
        </motion.div>
      ))}

      {/* Add Custom Question */}
      <div className="border border-dashed border-muted-foreground/30 rounded-lg p-4">
        <h4 className="font-medium mb-3 flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Add Custom Question
        </h4>
        <div className="space-y-3">
          <Textarea
            value={customQuestion}
            onChange={(e) => setCustomQuestion(e.target.value)}
            placeholder={placeholder}
            className="min-h-[60px] resize-none"
          />
          {showQuestionTypes && (
            <Select
              value={customQuestionType}
              onValueChange={(value) => {
                const newType = value as ScreeningQuestionType;
                onCustomQuestionTypeChange && onCustomQuestionTypeChange(newType);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="boolean">Boolean (Yes/No)</SelectItem>
                <SelectItem value="string">String (Text)</SelectItem>
                <SelectItem value="number">Number</SelectItem>
                <SelectItem value="array">Array (Multiple values)</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Button
            onClick={handleAddCustomQuestion}
            disabled={!customQuestion.trim()}
            size="sm"
            className="w-fit"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            {addButtonText}
          </Button>
        </div>
      </div>
    </div>
  );
}
