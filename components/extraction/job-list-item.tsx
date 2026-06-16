"use client";

import { useMemo } from "react";
import { motion } from "motion/react";
import type { Doc } from "@/convex/_generated/dataModel";
import { useTranslations, useFormatter, useNow } from "next-intl";
import { cn } from "@/lib/utils";
import { FileText, Clock, MessageSquare } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { ViewMode } from "@/lib/types";
import { subtleSpring } from "@/lib/animation-config";

type ExtractionJob = Doc<"extractionJobs">;

interface JobListItemProps {
  job: ExtractionJob;
  viewMode: ViewMode;
  index: number;
}

const STATUS_DOT_COLORS: Record<string, string> = {
  completed: "bg-emerald-500",
  failed: "bg-destructive",
  cancelled: "bg-muted-foreground",
};

const STATUS_STRIPE_COLORS: Record<string, string> = {
  completed: "bg-emerald-500",
  failed: "bg-destructive",
  cancelled: "bg-muted-foreground",
};

function getStatusDotColor(status: string) {
  return STATUS_DOT_COLORS[status] ?? "bg-primary animate-pulse";
}

function getStatusStripeColor(status: string) {
  return STATUS_STRIPE_COLORS[status] ?? "bg-primary";
}

export function JobListItem({ job, viewMode, index }: JobListItemProps) {
  const t = useTranslations("extraction");
  const tc = useTranslations("common");
  const tJob = useTranslations("jobStatus");
  const format = useFormatter();
  const now = useNow();

  const statusLabelMap: Record<string, string> = useMemo(() => ({
    completed: tc("completed"),
    failed: tc("failed"),
    cancelled: tc("cancelled"),
  }), [tc]);

  // Humanise the remaining states ("downloading_pdfs" → "downloading pdfs").
  // Translation keys for every pipeline status land in the plan-07 B11
  // translation pass; until then the English literal passes as aria-label
  // because it's already meaningful to a screen reader.
  const getStatusLabel = (status: string) =>
    statusLabelMap[status] ?? status.replace(/_/g, " ");
  const status = job.status ?? "pending";
  const totalPapers = job.totalPapers ?? 0;

  const isChat = job.mode === "chat";
  const messageCount = job.messageCount ?? 0;
  const bucketCount = isChat ? messageCount : totalPapers;
  const relativeTimestamp = new Date(
    isChat ? (job.lastMessageAt ?? job.updatedAt) : job.createdAt,
  );

  // list-simple: Single compact row
  if (viewMode === "list-simple") {
    return (
      <Link href={`/extraction/${job._id}`} className="block group">
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...subtleSpring, delay: index * 0.03 }}
          data-mode={job.mode}
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-xl",
            "bg-card/40 dark:bg-card/30",
            "border border-border/40",
            "hover:bg-card/70 hover:border-border/60 hover:shadow-sm",
            "transition-all duration-200"
          )}
        >
          {/* Status dot (hidden in chat mode — no pipeline state) */}
          {!isChat && (
            <span
              role="img"
              aria-label={getStatusLabel(status)}
              data-job-status={status}
              className={cn("w-2 h-2 rounded-full shrink-0", getStatusDotColor(status))}
            />
          )}

          {/* Mode badge */}
          <Badge
            variant={isChat ? "secondary" : "default"}
            data-mode={job.mode}
            className="shrink-0"
          >
            {isChat ? t("jobBadgeChat") : t("jobBadgeExtraction")}
          </Badge>

          {/* Job name */}
          <span className="flex-1 text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
            {job.name}
          </span>

          {/* Mode-aware count */}
          <span className="text-xs text-muted-foreground shrink-0">
            {isChat
              ? t("jobChatSubline", { messages: bucketCount })
              : tJob("papersCount", { count: totalPapers })}
          </span>

          {/* Time ago */}
          <span className="text-xs text-muted-foreground shrink-0">
            {format.relativeTime(relativeTimestamp, now)}
          </span>
        </motion.div>
      </Link>
    );
  }

  // list-detail: Detailed row
  if (viewMode === "list-detail") {
    return (
      <Link href={`/extraction/${job._id}`} className="block group">
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...subtleSpring, delay: index * 0.03 }}
          data-mode={job.mode}
          className={cn(
            "relative rounded-xl overflow-hidden",
            "bg-card/50 dark:bg-card/40",
            "border border-border/40",
            "hover:border-border/60 hover:shadow-md",
            "transition-all duration-200"
          )}
        >
          <div className="p-4">
            <div className="flex items-start gap-3">
              {/* Status dot (extraction only) */}
              {!isChat && (
                <span
                  role="img"
                  aria-label={getStatusLabel(status)}
                  data-job-status={status}
                  className={cn("w-2 h-2 rounded-full shrink-0 mt-2", getStatusDotColor(status))}
                />
              )}

              <div className="flex-1 min-w-0 space-y-2">
                {/* Header row: name + mode badge */}
                <div className="flex items-start gap-2">
                  <h3 className="flex-1 text-base font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                    {job.name}
                  </h3>
                  <Badge
                    variant={isChat ? "secondary" : "default"}
                    data-mode={job.mode}
                    className="shrink-0"
                  >
                    {isChat ? t("jobBadgeChat") : t("jobBadgeExtraction")}
                  </Badge>
                </div>

                {/* Description */}
                {job.description && (
                  <p className="text-sm text-muted-foreground truncate">
                    {job.description}
                  </p>
                )}

                {/* Metadata row */}
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  {!isChat && (
                    <>
                      <span className={cn("text-xs font-medium capitalize", {
                        "text-emerald-600 dark:text-emerald-400": status === "completed",
                        "text-destructive": status === "failed",
                        "text-primary": status !== "completed" && status !== "failed" && status !== "cancelled",
                      })}>
                        {getStatusLabel(status)}
                      </span>

                      <span className="w-1 h-1 rounded-full bg-border" />
                    </>
                  )}

                  <div className="flex items-center gap-1.5">
                    {isChat ? (
                      <MessageSquare className="w-3.5 h-3.5" />
                    ) : (
                      <FileText className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {isChat
                        ? t("jobChatSubline", { messages: bucketCount })
                        : tJob("papersCount", { count: totalPapers })}
                    </span>
                  </div>

                  <span className="w-1 h-1 rounded-full bg-border" />

                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{format.relativeTime(relativeTimestamp, now)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </Link>
    );
  }

  // grid-2 / grid-3: Card layout
  const isCompact = viewMode === "grid-3";

  return (
    <Link href={`/extraction/${job._id}`} className="block group">
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ ...subtleSpring, delay: index * 0.03 }}
        data-mode={job.mode}
        className={cn(
          "relative flex flex-col rounded-xl overflow-hidden",
          "bg-card/50 dark:bg-card/40",
          "border border-border/40",
          "hover:border-border/60 hover:shadow-md",
          "transition-all duration-200"
        )}
      >
        {/* Colored top stripe */}
        <div
          role={isChat ? undefined : "img"}
          aria-label={isChat ? undefined : getStatusLabel(status)}
          data-job-status={isChat ? undefined : status}
          className={cn("h-[3px]", isChat ? "bg-primary/60" : getStatusStripeColor(status))}
        />

        {/* Content */}
        <div className={cn("flex-1 flex flex-col", isCompact ? "p-3" : "p-4")}>
          {/* Header: name + mode badge */}
          <div className="flex items-start gap-2">
            <h3 className={cn(
              "flex-1 font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-2",
              isCompact ? "text-sm" : "text-base"
            )}>
              {job.name}
            </h3>
            <Badge
              variant={isChat ? "secondary" : "default"}
              data-mode={job.mode}
              className="shrink-0"
            >
              {isChat ? t("jobBadgeChat") : t("jobBadgeExtraction")}
            </Badge>
          </div>

          {/* Description */}
          {job.description && (
            <p className={cn(
              "text-muted-foreground line-clamp-1 mt-1",
              isCompact ? "text-xs" : "text-sm"
            )}>
              {job.description}
            </p>
          )}

          {/* Metadata */}
          <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/30">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {isChat ? (
                <MessageSquare className="w-3 h-3" />
              ) : (
                <FileText className="w-3 h-3" />
              )}
              <span>
                {isChat
                  ? t("jobChatSubline", { messages: bucketCount })
                  : tJob("papersCount", { count: totalPapers })}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              {format.relativeTime(relativeTimestamp, now)}
            </span>
          </div>
        </div>
      </motion.div>
    </Link>
  );
}
