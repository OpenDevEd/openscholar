"use client";

import { motion } from "motion/react";
import type { Doc } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { formatTimeAgo } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Download,
  Eye,
  Trash2,
  FileText,
} from "lucide-react";
import Link from "next/link";
import type { ViewMode } from "@/lib/types";

type ExtractionJob = Doc<"extractionJobs">;

interface JobListItemProps {
  job: ExtractionJob;
  viewMode: ViewMode;
}

export function JobListItem({ job, viewMode }: JobListItemProps) {
  const progress =
    job.totalPapers > 0
      ? Math.round(
          ((job.processedPapers + job.failedPapers) / job.totalPapers) * 100
        )
      : 0;

  const isActive =
    job.status === "pending" ||
    job.status === "downloading_pdfs" ||
    job.status === "indexing" ||
    job.status === "extracting";

  const getStatusIcon = () => {
    switch (job.status) {
      case "completed":
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case "failed":
      case "cancelled":
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return isActive ? (
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
        ) : (
          <FileText className="w-4 h-4 text-muted-foreground" />
        );
    }
  };

  const getStatusBadge = () => {
    const variants: Record<string, string> = {
      pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
      downloading_pdfs: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
      indexing: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
      extracting: "bg-primary/10 text-primary",
      completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
      failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
      cancelled: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400",
    };

    const labels: Record<string, string> = {
      pending: "Pending",
      downloading_pdfs: "Downloading",
      indexing: "Indexing",
      extracting: "Extracting",
      completed: "Completed",
      failed: "Failed",
      cancelled: "Cancelled",
    };

    return (
      <Badge variant="outline" className={cn("text-xs", variants[job.status])}>
        {labels[job.status]}
      </Badge>
    );
  };

  if (viewMode === "list-simple") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={{ scale: 1.005 }}
        className="group"
      >
        <Link href={`/extraction/${job._id}`}>
          <Card className="bg-card/50 hover:bg-card/80 transition-colors cursor-pointer">
            <CardContent className="p-3 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                {getStatusIcon()}
                <span className="font-medium truncate">{job.name}</span>
                <span className="text-xs text-muted-foreground">
                  {job.totalPapers} papers
                </span>
              </div>
              <div className="flex items-center gap-2">
                {getStatusBadge()}
                <span className="text-xs text-muted-foreground">
                  {formatTimeAgo(new Date(job.createdAt))}
                </span>
              </div>
            </CardContent>
          </Card>
        </Link>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.005 }}
      className="group"
    >
      <Link href={`/extraction/${job._id}`}>
        <Card
          className={cn(
            "relative overflow-hidden cursor-pointer",
            "bg-card/50 hover:bg-card/80",
            "transition-all duration-200",
            isActive && "ring-1 ring-primary/20"
          )}
        >
          <CardContent className="p-4 space-y-3">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={cn(
                    "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                    isActive
                      ? "bg-primary/10"
                      : job.status === "completed"
                      ? "bg-green-500/10"
                      : "bg-muted"
                  )}
                >
                  {getStatusIcon()}
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold truncate">{job.name}</h3>
                  {job.description && (
                    <p className="text-sm text-muted-foreground truncate">
                      {job.description}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {getStatusBadge()}
              </div>
            </div>

            {/* Progress */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Progress</span>
                <span className="font-medium">{progress}%</span>
              </div>
              <Progress value={progress} className="h-1.5" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {job.processedPapers} processed
                  {job.failedPapers > 0 && (
                    <>, {<span className="text-red-500">{job.failedPapers} failed</span>}</>
                  )}
                </span>
                <span>{job.totalPapers} total</span>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-2 border-t border-border/40">
              <span className="text-xs text-muted-foreground">
                Created {formatTimeAgo(new Date(job.createdAt))}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <Eye className="h-3.5 w-3.5" />
                </Button>
                {job.status === "completed" && (
                  <>
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </Link>
    </motion.div>
  );
}
