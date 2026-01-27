"use client";

import React, { useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  FileText,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Question {
  id: string;
  key: string;
  question: string;
  type: string;
}

interface ExtractionSource {
  quote: string;
  sourceType: "abstract" | "pdf";
  pageNumber?: number;
  startChar: number;
  endChar: number;
}

interface ExtractionValue {
  value: string | number | boolean | null;
  status: string;
  confidence?: number;
  reasoning?: string;
  sources?: ExtractionSource[];
}

interface ResultRow {
  documentId: Id<"documents">;
  title: string;
  authors?: string[];
  year?: number;
  extractions: Record<string, ExtractionValue>;
}

interface ExtractionResultsTableProps {
  questions: Question[];
  rows: ResultRow[];
}

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  pending: {
    icon: <Clock className="h-3.5 w-3.5" />,
    label: "Pending",
    color: "text-muted-foreground",
  },
  processing: {
    icon: <AlertCircle className="h-3.5 w-3.5 animate-pulse" />,
    label: "Processing",
    color: "text-blue-500",
  },
  completed: {
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    label: "Completed",
    color: "text-green-600",
  },
  error: {
    icon: <XCircle className="h-3.5 w-3.5" />,
    label: "Error",
    color: "text-red-500",
  },
};

function formatValue(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString();
  return value;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trim() + "…";
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
      onClick={handleCopy}
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-600" />
      ) : (
        <Copy className="h-3 w-3 text-muted-foreground" />
      )}
    </Button>
  );
}

function SourcesList({ sources }: { sources: ExtractionSource[] }) {
  if (!sources || sources.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Sources ({sources.length})
      </p>
      {sources.map((source, i) => (
        <div
          key={i}
          className="text-sm border-l-2 border-muted-foreground/30 pl-3 space-y-1"
        >
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {source.sourceType === "pdf" ? (
              <>
                <FileText className="h-3 w-3" />
                <span>Page {source.pageNumber ?? "?"}</span>
              </>
            ) : (
              <>
                <BookOpen className="h-3 w-3" />
                <span>Abstract</span>
              </>
            )}
            <span className="text-muted-foreground/60">
              chars {source.startChar}–{source.endChar}
            </span>
          </div>
          <p className="text-muted-foreground italic text-sm leading-relaxed">
            "{source.quote}"
          </p>
        </div>
      ))}
    </div>
  );
}

function ExtractionItem({
  question,
  extraction,
}: {
  question: Question;
  extraction: ExtractionValue;
}) {
  const status = STATUS_CONFIG[extraction.status] || STATUS_CONFIG.pending;
  const value = formatValue(extraction.value);
  const isLongText = typeof extraction.value === "string" && extraction.value.length > 200;

  return (
    <div className="py-3 border-b border-border/50 last:border-0">
      {/* Question header */}
      <div className="flex items-start justify-between gap-4 mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">{question.question}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Type: {question.type}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {extraction.confidence !== undefined && extraction.status === "completed" && (
            <Badge variant="secondary" className="text-xs">
              {Math.round(extraction.confidence * 100)}%
            </Badge>
          )}
          <div className={cn("flex items-center gap-1", status.color)}>
            {status.icon}
            <span className="text-xs">{status.label}</span>
          </div>
        </div>
      </div>

      {/* Value */}
      {extraction.status === "completed" && (
        <div className="group relative">
          <div
            className={cn(
              "rounded-md bg-muted/50 p-3",
              isLongText && "max-h-48 overflow-y-auto"
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm whitespace-pre-wrap break-words flex-1">
                {value}
              </p>
              {typeof extraction.value === "string" && extraction.value.length > 0 && (
                <CopyButton text={extraction.value} />
              )}
            </div>
          </div>

          {/* Reasoning */}
          {extraction.reasoning && (
            <p className="mt-2 text-xs text-muted-foreground">
              <span className="font-medium">Reasoning:</span> {extraction.reasoning}
            </p>
          )}

          {/* Sources */}
          <SourcesList sources={extraction.sources || []} />
        </div>
      )}

      {extraction.status === "pending" && (
        <p className="text-sm text-muted-foreground italic">Waiting for extraction...</p>
      )}

      {extraction.status === "processing" && (
        <p className="text-sm text-blue-600 italic">Extracting...</p>
      )}

      {extraction.status === "error" && (
        <p className="text-sm text-red-500 italic">Extraction failed</p>
      )}
    </div>
  );
}

function DocumentRow({
  row,
  questions,
  defaultOpen = false,
}: {
  row: ResultRow;
  questions: Question[];
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  // Calculate summary stats
  const completed = Object.values(row.extractions).filter(
    (e) => e.status === "completed"
  ).length;
  const pending = Object.values(row.extractions).filter(
    (e) => e.status === "pending"
  ).length;
  const errors = Object.values(row.extractions).filter(
    (e) => e.status === "error"
  ).length;
  const total = questions.length;

  // Get first few extracted values for preview
  const previewValues = questions
    .slice(0, 3)
    .map((q) => {
      const extraction = row.extractions[q.id];
      if (extraction?.status === "completed" && extraction.value !== null) {
        const formatted = formatValue(extraction.value);
        return truncate(formatted, 50);
      }
      return null;
    })
    .filter(Boolean);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="border border-border/50 rounded-lg overflow-hidden">
        {/* Header - always visible */}
        <CollapsibleTrigger asChild>
          <button className="w-full text-left p-4 hover:bg-muted/50 transition-colors flex items-start gap-3">
            <div className="shrink-0 pt-0.5">
              {isOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              {/* Title and metadata */}
              <p className="font-medium text-sm leading-snug pr-4">
                {row.title}
              </p>
              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                {row.authors && row.authors.length > 0 && (
                  <span>
                    {row.authors.slice(0, 2).join(", ")}
                    {row.authors.length > 2 && ` +${row.authors.length - 2}`}
                  </span>
                )}
                {row.year && <span>({row.year})</span>}
              </div>

              {/* Preview values when collapsed */}
              {!isOpen && previewValues.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  {previewValues.map((v, i) => (
                    <Badge
                      key={i}
                      variant="secondary"
                      className="text-xs font-normal max-w-[200px] truncate"
                    >
                      {v}
                    </Badge>
                  ))}
                  {questions.length > 3 && completed > 3 && (
                    <span className="text-xs text-muted-foreground">
                      +{completed - 3} more
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Status badges */}
            <div className="flex items-center gap-2 shrink-0">
              {completed > 0 && (
                <Badge className="bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400 text-xs">
                  {completed}/{total}
                </Badge>
              )}
              {pending > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {pending} pending
                </Badge>
              )}
              {errors > 0 && (
                <Badge variant="destructive" className="text-xs">
                  {errors} failed
                </Badge>
              )}
            </div>
          </button>
        </CollapsibleTrigger>

        {/* Expanded content */}
        <CollapsibleContent>
          <div className="border-t border-border/50 bg-muted/20 p-4">
            {questions.map((q) => (
              <ExtractionItem
                key={q.id}
                question={q}
                extraction={row.extractions[q.id]}
              />
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function ExtractionResultsTable({
  questions,
  rows,
}: ExtractionResultsTableProps) {
  const [expandAll, setExpandAll] = useState(false);

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Extraction Results</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No documents to extract from.</p>
            <p className="text-sm mt-1">Add sources first, then run extraction.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Calculate overall stats
  const totalExtractions = rows.length * questions.length;
  const completedExtractions = rows.reduce(
    (acc, row) =>
      acc +
      Object.values(row.extractions).filter((e) => e.status === "completed").length,
    0
  );
  const pendingExtractions = rows.reduce(
    (acc, row) =>
      acc +
      Object.values(row.extractions).filter((e) => e.status === "pending").length,
    0
  );
  const errorExtractions = rows.reduce(
    (acc, row) =>
      acc +
      Object.values(row.extractions).filter((e) => e.status === "error").length,
    0
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Extraction Results</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {completedExtractions}/{totalExtractions} extractions completed
              {pendingExtractions > 0 && ` • ${pendingExtractions} pending`}
              {errorExtractions > 0 && ` • ${errorExtractions} failed`}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpandAll(!expandAll)}
          >
            {expandAll ? "Collapse All" : "Expand All"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {rows.map((row) => (
            <DocumentRow
              key={row.documentId}
              row={row}
              questions={questions}
              defaultOpen={expandAll}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
