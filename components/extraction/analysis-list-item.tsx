"use client";

import React from "react";
import { motion } from "motion/react";
import { Database, FileText, Calendar, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { subtleSpring } from "@/lib/animation-config";
import type { Id } from "@/convex/_generated/dataModel";

interface AnalysisListItemProps {
  analysis: {
    _id: Id<"analyses">;
    name: string;
    description?: string;
    status: "draft" | "processing" | "completed" | "failed";
    questionCount: number;
    createdAt: number;
    updatedAt: number;
  };
  onClick: () => void;
}

const STATUS_CONFIG = {
  draft: { label: "Draft", color: "text-muted-foreground bg-muted" },
  processing: { label: "Processing", color: "text-blue-600 bg-blue-50 dark:bg-blue-950/30" },
  completed: { label: "Completed", color: "text-green-600 bg-green-50 dark:bg-green-950/30" },
  failed: { label: "Failed", color: "text-red-600 bg-red-50 dark:bg-red-950/30" },
};

export function AnalysisListItem({ analysis, onClick }: AnalysisListItemProps) {
  const statusConfig = STATUS_CONFIG[analysis.status];

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={subtleSpring}
      onClick={onClick}
      className={cn(
        "group relative p-4 rounded-xl border border-border/50",
        "bg-background/50 hover:bg-background",
        "cursor-pointer transition-all duration-200",
        "hover:border-border hover:shadow-md"
      )}
    >
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center shrink-0">
          <Database className="h-5 w-5 text-primary" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors truncate">
              {analysis.name}
            </h3>
            <span
              className={cn(
                "px-2 py-0.5 rounded-full text-xs font-medium shrink-0",
                statusConfig.color
              )}
            >
              {statusConfig.label}
            </span>
          </div>

          {analysis.description && (
            <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
              {analysis.description}
            </p>
          )}

          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              <span>{analysis.questionCount} {analysis.questionCount === 1 ? "question" : "questions"}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              <span>{new Date(analysis.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
