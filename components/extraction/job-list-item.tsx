"use client";

import type { Doc } from "@/convex/_generated/dataModel";
import { useTranslations, useFormatter, useNow } from "next-intl";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { JobStatusIcon } from "./job-status-icon";
import { Database, MessageSquare } from "@/components/icons";
import { LIST_TILE } from "@/components/evidence-libraries/list-controls";
import { Entry, EntryAside, ENTRY_OPEN, isGrid, isRoomy } from "@/components/command-center/entry";
import type { ViewMode } from "@/lib/types";

type ExtractionJob = Doc<"extractionJobs">;

interface JobListItemProps {
  job: ExtractionJob;
  viewMode: ViewMode;
}

export function JobListItem({ job, viewMode }: JobListItemProps) {
  const t = useTranslations("extraction");
  const tc = useTranslations("common");
  const tJob = useTranslations("jobStatus");
  const format = useFormatter();
  const now = useNow();

  const statusLabelMap: Record<string, string> = {
    completed: tc("completed"),
    failed: tc("failed"),
    cancelled: tc("cancelled"),
  };
  // Humanise the remaining states ("downloading_pdfs" → "downloading pdfs").
  // Translation keys for every pipeline status land in the plan-07 B11
  // translation pass; until then the English literal passes as aria-label
  // because it's already meaningful to a screen reader.
  const status = job.status ?? "pending";
  const statusLabel = statusLabelMap[status] ?? status.replace(/_/g, " ");

  const isChat = job.mode === "chat";
  const roomy = isRoomy(viewMode);
  const KindIcon = isChat ? MessageSquare : Database;

  // Which kind of job this is: a chat, or an extraction.
  const kind = roomy ? (
    <span role="img" aria-label={isChat ? t("jobBadgeChat") : t("jobBadgeExtraction")} className={cn(LIST_TILE, "shrink-0")}>
      <KindIcon aria-hidden className="size-5" />
    </span>
  ) : (
    <span role="img" aria-label={isChat ? t("jobBadgeChat") : t("jobBadgeExtraction")} className="flex shrink-0 text-primary">
      <KindIcon aria-hidden className="size-4" />
    </span>
  );
  // A chat has no pipeline, so it has no state to show.
  const state = isChat ? null : <JobStatusIcon status={status} label={statusLabel} className="relative z-10" />;
  const open = (clamp: string) => (
    <Link href={`/extraction/${job._id}`} className={cn(ENTRY_OPEN, clamp)}>
      {job.name}
    </Link>
  );
  const size = (
    <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
      {isChat ? t("jobChatSubline", { messages: job.messageCount ?? 0 }) : tJob("papersCount", { count: job.totalPapers ?? 0 })}
    </span>
  );
  const description = job.description ? <p className="truncate text-xs text-muted-foreground">{job.description}</p> : null;
  const time = (
    <EntryAside
      className={cn(viewMode === "list-detail" && "h-7 self-start", viewMode === "list-simple" && "max-sm:hidden")}
      meta={
        <time dateTime={new Date(isChat ? (job.lastMessageAt ?? job.updatedAt) : job.createdAt).toISOString()}>
          {format.relativeTime(new Date(isChat ? (job.lastMessageAt ?? job.updatedAt) : job.createdAt), now)}
        </time>
      }
    />
  );

  return (
    <Entry viewMode={viewMode} data-mode={job.mode}>
      {isGrid(viewMode) ? (
        <>
          <div className="flex items-center gap-2">
            {kind}
            {state}
            <span className="flex-1" />
            {time}
          </div>
          {open("line-clamp-2")}
          {roomy && description}
          {size}
        </>
      ) : roomy ? (
        <>
          {kind}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2">
              {open("truncate")}
              {state}
            </div>
            {description}
            {size}
          </div>
          {time}
        </>
      ) : (
        <>
          {kind}
          <span className="min-w-0">{open("block w-full truncate")}</span>
          {state}
          <span className="flex-1" />
          {size}
          {time}
        </>
      )}
    </Entry>
  );
}
