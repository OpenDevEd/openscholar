"use client";

import { motion } from "motion/react";
import type { Doc } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { formatTimeAgo } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  FileText,
  Clock,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import type { ViewMode } from "@/lib/types";

type ExtractionJob = Doc<"extractionJobs">;

interface JobListItemProps {
  job: ExtractionJob;
  viewMode: ViewMode;
}

export function JobListItem({ job, viewMode }: JobListItemProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "text-green-500 bg-green-500/10 border-green-500/20";
      case "failed":
        return "text-red-500 bg-red-500/10 border-red-500/20";
      case "cancelled":
        return "text-gray-500 bg-gray-500/10 border-gray-500/20";
      default:
        return "text-primary bg-primary/10 border-primary/20";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="w-4 h-4" />;
      case "failed":
      case "cancelled":
        return <XCircle className="w-4 h-4" />;
      default:
        return <Loader2 className="w-4 h-4 animate-spin" />;
    }
  };

  return (
    <Link href={`/extraction/${job._id}`} className="block">
      <motion.div
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="group relative rounded-xl border border-border/40 bg-card/50 px-4 py-4 hover:bg-muted/40 transition-all duration-300 hover:shadow-sm"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0 flex-1">
            {/* Status Icon Wrapper */}
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border shadow-sm transition-colors",
                getStatusColor(job.status),
              )}
            >
              {getStatusIcon(job.status)}
            </div>

            {/* Info */}
            <div className="flex flex-col min-w-0 gap-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground truncate">
                  {job.name}
                </span>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] h-5 px-1.5 font-normal capitalize bg-transparent",
                    job.status === "completed"
                      ? "text-green-600 border-green-200 dark:border-green-800"
                      : "text-muted-foreground",
                  )}
                >
                  {job.status.replace("_", " ")}
                </Badge>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  <FileText className="w-3 h-3" />
                  <span>
                    {job.processedPapers} / {job.totalPapers} processed
                  </span>
                </div>
                <div className="w-1 h-1 rounded-full bg-border" />
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span>{formatTimeAgo(new Date(job.createdAt))}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Action Area */}
          <div className="flex items-center gap-4 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-background border shadow-sm">
              <ArrowRight className="w-4 h-4 text-muted-foreground" />
            </div>
          </div>
        </div>
      </motion.div>
    </Link>
  );
}
