"use client";

import React from "react";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Clock, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Question {
  id: string;
  key: string;
  question: string;
  type: string;
}

interface ExtractionValue {
  value: string | number | boolean | null;
  status: string; // Allow any string from backend
  confidence?: number;
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

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending: <Clock className="h-4 w-4 text-muted-foreground" />,
  processing: <AlertCircle className="h-4 w-4 text-blue-500 animate-pulse" />,
  completed: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  error: <XCircle className="h-4 w-4 text-red-500" />,
};

function formatValue(value: string | number | boolean | null, type: string): string {
  if (value === null) return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toString();
  return value;
}

function ExtractionCell({ extraction, type }: { extraction: ExtractionValue; type: string }) {
  const icon = STATUS_ICONS[extraction.status] || STATUS_ICONS.pending;
  const formattedValue = formatValue(extraction.value, type);

  if (extraction.status === "pending") {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-sm">Pending</span>
      </div>
    );
  }

  if (extraction.status === "error") {
    return (
      <div className="flex items-center gap-2 text-destructive">
        {icon}
        <span className="text-sm">Error</span>
      </div>
    );
  }

  if (extraction.status === "processing") {
    return (
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm">Processing...</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2">
            {icon}
            <span className="text-sm">{formattedValue}</span>
            {extraction.confidence !== undefined && (
              <Badge variant="outline" className="text-xs">
                {Math.round(extraction.confidence * 100)}%
              </Badge>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>Confidence: {extraction.confidence ? Math.round(extraction.confidence * 100) : 0}%</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

export function ExtractionResultsTable({ questions, rows }: ExtractionResultsTableProps) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Extraction Results</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            No documents to extract from. Add sources first.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Extraction Results</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[300px] sticky left-0 bg-background z-10">
                  Document
                </TableHead>
                {questions.map((q) => (
                  <TableHead key={q.id} className="min-w-[200px]">
                    <div>
                      <div className="font-semibold">{q.question}</div>
                      <div className="text-xs text-muted-foreground">{q.type}</div>
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.documentId}>
                  <TableCell className="sticky left-0 bg-background z-10 font-medium">
                    <div>
                      <div className="line-clamp-2">{row.title}</div>
                      {row.authors && row.authors.length > 0 && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {row.authors.slice(0, 2).join(", ")}
                          {row.authors.length > 2 && ` +${row.authors.length - 2}`}
                        </div>
                      )}
                      {row.year && (
                        <div className="text-xs text-muted-foreground">{row.year}</div>
                      )}
                    </div>
                  </TableCell>
                  {questions.map((q) => (
                    <TableCell key={q.id}>
                      <ExtractionCell
                        extraction={row.extractions[q.id]}
                        type={q.type}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
