"use client";

import { motion } from "motion/react";
import type { Doc } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { formatTimeAgo } from "@/lib/format";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  FileText,
  Clock,
  ArrowRight,
  AlertCircle,
} from "lucide-react";
import Link from "next/link";
import type { ViewMode } from "@/lib/types";

type ExtractionJob = Doc<"extractionJobs">;

interface JobListItemProps {
  job: ExtractionJob;
  viewMode: ViewMode;
  index: number;
}

export function JobListItem({ job, index }: JobListItemProps) {
  const getStatusConfig = (status: string) => {
    switch (status) {
      case "completed":
        return {
          icon: CheckCircle2,
          bgColor: "bg-emerald-500/10",
          borderColor: "border-emerald-500/20",
          textColor: "text-emerald-600 dark:text-emerald-400",
          barColor: "bg-emerald-500",
          label: "Completed",
        };
      case "failed":
        return {
          icon: XCircle,
          bgColor: "bg-destructive/10",
          borderColor: "border-destructive/20",
          textColor: "text-destructive",
          barColor: "bg-destructive",
          label: "Failed",
        };
      case "cancelled":
        return {
          icon: AlertCircle,
          bgColor: "bg-muted",
          borderColor: "border-border",
          textColor: "text-muted-foreground",
          barColor: "bg-muted-foreground",
          label: "Cancelled",
        };
      default:
        return {
          icon: Loader2,
          bgColor: "bg-primary/10",
          borderColor: "border-primary/20",
          textColor: "text-primary",
          barColor: "bg-primary",
          label: status.replace(/_/g, " "),
        };
    }
  };

  const status = getStatusConfig(job.status);
  const StatusIcon = status.icon;

  const progressPercentage =
    job.totalPapers > 0
      ? Math.round((job.processedPapers / job.totalPapers) * 100)
      : 0;

  const isProcessing =
    job.status === "pending" ||
    job.status === "downloading_pdfs" ||
    job.status === "extracting";

  return (
    <Link href={`/extraction/${job._id}`} className="block group">
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{
          duration: 0.4,
          delay: index * 0.05,
          ease: [0.22, 1, 0.36, 1],
        }}
        className={cn(
          "relative py-6 px-4 sm:px-6 transition-colors hover:bg-muted/50",
          index % 2 === 0 ? "bg-background" : "bg-muted/30"
        )}
      >
        <div className="flex flex-col lg:flex-row lg:items-center gap-4 lg:gap-8">
          {/* Left: Status & Progress */}
          <div className="flex items-center gap-4 lg:w-64 shrink-0">
            <motion.div
              whileHover={{ scale: 1.05 }}
              className={cn(
                "w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border-2",
                status.bgColor,
                status.borderColor
              )}
            >
              <StatusIcon
                className={cn(
                  "w-6 h-6",
                  status.textColor,
                  isProcessing && "animate-spin"
                )}
              />
            </motion.div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={cn("text-sm font-semibold", status.textColor)}>
                  {status.label}
                </span>
                <span className="text-muted-foreground text-sm">
                  {progressPercentage}%
                </span>
              </div>

              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${progressPercentage}%` }}
                  transition={{
                    duration: 0.8,
                    delay: index * 0.05 + 0.2,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  className={cn("h-full rounded-full", status.barColor)}
                />
              </div>
            </div>
          </div>

          {/* Middle: Job Info */}
          <div className="flex-1 min-w-0 space-y-1">
            <h3 className="text-lg font-semibold text-foreground truncate group-hover:text-primary transition-colors duration-200">
              {job.name}
            </h3>

            {job.description && (
              <p className="text-sm text-muted-foreground truncate">
                {job.description}
              </p>
            )}

            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <FileText className="w-4 h-4" />
                <span>
                  {job.processedPapers.toLocaleString()} /{" "}
                  {job.totalPapers.toLocaleString()} papers
                </span>
              </div>

              <span className="w-1 h-1 rounded-full bg-border" />

              <div className="flex items-center gap-1.5">
                <Clock className="w-4 h-4" />
                <span>{formatTimeAgo(new Date(job.createdAt))}</span>
              </div>
            </div>
          </div>

          {/* Right: Action Arrow */}
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: index * 0.05 + 0.3 }}
            className="flex items-center justify-end lg:w-12"
          >
            <motion.div
              initial={{ x: 0 }}
              whileHover={{ x: 4 }}
              className="w-10 h-10 rounded-full border-2 border-border flex items-center justify-center group-hover:border-primary group-hover:bg-primary/5 transition-all duration-200"
            >
              <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </motion.div>
          </motion.div>
        </div>
      </motion.div>
    </Link>
  );
}
