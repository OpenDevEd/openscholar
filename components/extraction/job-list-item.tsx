"use client";

import type { Doc } from "@/convex/_generated/dataModel";
import { useTranslations, useFormatter, useNow } from "next-intl";
import Link from "@/components/workspace-link";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { JobStatusIcon } from "./job-status-icon";
import { ExtractionIcon } from "@/components/icons";
import { Ring } from "@/components/ui/progress-ring";
import { Entry, EntryAside, ENTRY_OPEN, isGrid, isRoomy } from "@/components/command-center/entry";
import type { ViewMode } from "@/lib/types";

type ExtractionJob = Doc<"extractionJobs">;

interface JobListItemProps {
  job: ExtractionJob;
  viewMode: ViewMode;
  /** Who ran it, inside the ring in place of the extraction icon, in an organization (#656). */
  face?: ReactNode;
  /** Its papers done so far, which its list reads from the counts its workers keep. */
  done?: number;
}

/** The ring's colour for a job's state; a job waiting to start has a dashed one. */
const RING: Record<string, { color: string; dashed?: boolean }> = {
  pending: { color: "var(--warning)", dashed: true },
  completed: { color: "var(--success)" },
  failed: { color: "var(--destructive)" },
  cancelled: { color: "var(--muted-foreground)" },
  paused: { color: "var(--muted-foreground)" },
  creditsExhausted: { color: "var(--warning)" },
};

export function JobListItem({ job, viewMode, face, done = 0 }: JobListItemProps) {
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

  const roomy = isRoomy(viewMode);

  // The job at a glance: a ring that fills as its papers are read, around the extraction icon.
  const large = viewMode === "list-detail";
  const ring = RING[status] ?? { color: "var(--primary)" };
  const progress = status === "completed" ? 1 : job.totalPapers ? Math.min(1, done / job.totalPapers) : 0;
  const kind = (
    <span role="img" aria-label={t("jobBadgeExtraction")} className={cn("relative flex shrink-0 items-center justify-center", large ? "size-11" : "size-8")}>
      <Ring value={progress} color={ring.color} dashed={ring.dashed} />
      {face ?? <ExtractionIcon aria-hidden className={cn("text-muted-foreground", large ? "size-5" : "size-4")} />}
    </span>
  );
  // The icon sits above the entry's hit area so it can say what it means, in a link of its own so a click on it still opens the job.
  const state = (
    <Link href={`/extraction/${job._id}`} tabIndex={-1} className="relative z-10 flex shrink-0">
      <JobStatusIcon status={status} label={statusLabel} />
    </Link>
  );
  const open = (clamp: string) => (
    <Link href={`/extraction/${job._id}`} className={cn(ENTRY_OPEN, clamp)}>
      {job.name}
    </Link>
  );
  const size = (
    <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
      {tJob("papersCount", { count: job.totalPapers ?? 0 })}
    </span>
  );
  const description = job.description ? <p className="truncate text-xs text-muted-foreground">{job.description}</p> : null;
  const time = (
    <EntryAside
      className={cn(viewMode === "list-detail" && "h-7 self-start", viewMode === "list-simple" && "max-sm:hidden")}
      meta={
        <time dateTime={new Date(job.createdAt).toISOString()}>
          {format.relativeTime(new Date(job.createdAt), now)}
        </time>
      }
    />
  );

  return (
    <Entry viewMode={viewMode}>
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
