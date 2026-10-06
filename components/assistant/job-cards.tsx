"use client";

// The live card of a job a reply started (#328): a screening fills its bar as papers are decided,
// an extraction fills each paper's answers as they're read. Each reads the job's own progress
// (convex/assistant/jobs.ts) and keeps one size from its first frame, whatever arrives.

import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { motion } from "motion/react";
import { Ban, Check, CircleAlert, CircleHelp, Coins, ExternalLink, Hourglass, X } from "@/components/icons";
import { EASE } from "@/components/settings/model-map";
import { TooltipHint } from "@/components/ui/tooltip";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getErrorMessage, useAppToast } from "@/lib/toast/use-app-toast";
import { cn } from "@/lib/utils";
import { WorkingText } from "./parts";
import { KindTile } from "./steps";

type Read = NonNullable<FunctionReturnType<typeof api.assistant.jobs.card>>;
export type Screening = Extract<Read["card"], { kind: "screening" }>;
export type Extraction = Extract<Read["card"], { kind: "extraction" }>;

/** The actions that start a job: a step of one, once it ran, shows the job's card. */
export const JOB_STARTS = new Set(["screening/start:screen", "extraction/start:extract"]);

/** A job card's height, held from its first frame so the chat around it never moves. */
export const JOB_CARD_H = 118;
const RUNNING = new Set(["processing", "pending", "downloading_pdfs", "indexing", "extracting"]);

/** A job's card, by the step that started it. */
export function JobCard({ threadId, stepId }: { threadId: Id<"assistantThreads">; stepId: string }) {
  const read = useQuery(api.assistant.jobs.card, { threadId, stepId: stepId as Id<"assistantSteps"> });
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }} style={{ height: JOB_CARD_H }}>
      {read === undefined ? (
        // Its frame until the job's progress arrives.
        <div className="h-full rounded-2xl border border-border/60 bg-muted/40" />
      ) : read === null ? null : read.card.kind === "screening" ? (
        <ScreeningCard job={read.card} mine={read.mine} />
      ) : (
        <ExtractionCard job={read.card} mine={read.mine} />
      )}
    </motion.div>
  );
}

/** Cancel while it runs, and how it ended after: one slot, one size, so nothing beside it moves. */
function EndSlot({ running, status, capped, cancelLabel, onCancel, mine }: { running: boolean; status: string; capped?: boolean; cancelLabel: string; onCancel: () => void; mine: boolean }) {
  const t = useTranslations("assistant.jobs");
  if (running && mine) {
    return (
      <TooltipHint label={cancelLabel}>
        <button type="button" aria-label={cancelLabel} onClick={onCancel} className="-mr-1 flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="size-4" />
        </button>
      </TooltipHint>
    );
  }
  return (
    <span className="-mr-1 flex size-7 shrink-0 items-center justify-center">
      {running ? null : status === "cancelled" ? (
        <Ban className="size-4 text-muted-foreground" aria-label={t("cancelled")} />
      ) : status === "completed" && !capped ? (
        <Check className="size-4 text-emerald-600 dark:text-emerald-400" aria-label={t("finished")} />
      ) : (
        <CircleAlert className={cn("size-4", status === "failed" ? "text-destructive" : "text-amber-600")} aria-label={t(status === "failed" ? "failed" : "stopped")} />
      )}
    </span>
  );
}

function useCancel(cancel: () => Promise<unknown>) {
  const toast = useAppToast();
  const t = useTranslations("assistant.jobs");
  return () => void cancel().catch((error) => toast.error(t("cancelFailed"), getErrorMessage(error, "")));
}

function Credits({ credits }: { credits: number }) {
  const t = useTranslations("assistant.jobs");
  return (
    <p className="flex items-center gap-1 text-xs text-muted-foreground">
      <Coins className="size-3" /> {t.rich("credits", { count: credits, n: (chunks) => <span className="tabular-nums">{chunks}</span> })}
    </p>
  );
}

const fade = (on: boolean) => ({ initial: false as const, animate: { opacity: on ? 1 : 0 }, transition: { duration: 0.3, ease: EASE } });

/**
 * A job's card: its title and credits over a count, one bar, and a line under it. Every job
 * shows the same frame at the same height, so a chat holding several reads as one list.
 */
function LiveCard({
  kind,
  title,
  running,
  credits,
  done,
  total,
  end,
  bar,
  legend,
  href,
}: {
  kind: "screening" | "extraction";
  title: string;
  running: boolean;
  credits: number;
  done: number;
  total: number;
  end: ReactNode;
  bar: ReactNode;
  legend: ReactNode;
  /** Its page, which shows a job to its owner alone. */
  href: string | null;
}) {
  const t = useTranslations("assistant.jobs");
  return (
    <div className="h-full rounded-2xl border border-border/60 bg-muted/40 p-4">
      <div className="flex items-center gap-3">
        <KindTile kind={kind} working={running} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{running ? <WorkingText>{title}</WorkingText> : title}</p>
          <Credits credits={credits} />
        </div>
        <span className="text-sm font-semibold tabular-nums">
          {done}
          <span className="font-normal text-muted-foreground"> / {total}</span>
        </span>
        {end}
      </div>
      <div className="mt-3 grid h-2 [&>*]:col-start-1 [&>*]:row-start-1">{bar}</div>
      <div className="mt-2.5 flex items-center gap-4 text-xs text-muted-foreground">
        <div className="grid min-w-0 flex-1 [&>*]:col-start-1 [&>*]:row-start-1">{legend}</div>
        {href ? (
          <Link href={href} className="flex shrink-0 items-center gap-1 font-medium text-foreground/80 hover:text-foreground">
            {t("open")} <ExternalLink className="size-3" />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/** One track that segments fill from the left, each a share of the job's papers. */
function Track({ total, parts, on = true }: { total: number; parts: { n: number; className: string }[]; on?: boolean }) {
  return (
    <motion.div {...fade(on)} className="flex h-2 overflow-hidden rounded-full bg-foreground/10">
      {parts.map((part) => (
        <motion.span key={part.className} className={cn("h-full", part.className)} initial={false} animate={{ width: `${total ? (part.n / total) * 100 : 0}%` }} transition={{ duration: 0.3, ease: EASE }} />
      ))}
    </motion.div>
  );
}

/**
 * A screening. It first waits while the person's other papers take their slots, then fills in
 * as papers are decided. Waiting and running share one frame, cross-fading their bar and
 * legend, so the card never changes size.
 */
export function ScreeningCard({ job, mine }: { job: Screening; mine: boolean }) {
  const t = useTranslations("assistant.jobs");
  const cancel = useCancel(useMutation(api.screening.mutations.cancelScreeningJob).bind(null, { jobId: job.jobId }));
  const done = job.included + job.excluded + job.unclear + job.failed;
  const running = RUNNING.has(job.status);
  const queued = running && job.waiting !== undefined;
  const stopped = job.capped || job.status === "creditsExhausted";
  const title = queued
    ? t("screening.waiting", { count: job.total })
    : job.status === "cancelled"
      ? t("screening.cancelled", { done, total: job.total })
      : stopped
        ? t("screening.stopped", { done, total: job.total })
        : job.status === "failed"
          ? t("screening.failed")
          : running
            ? t("screening.running", { count: job.total })
            : t("screening.done", { count: job.total });
  return (
    <LiveCard
      kind="screening"
      title={title}
      running={running}
      credits={job.credits}
      done={done}
      total={job.total}
      href={mine ? `/screening?job=${job.jobId}` : null}
      end={<EndSlot running={running} status={job.status} capped={stopped} cancelLabel={t("screening.cancel")} onCancel={cancel} mine={mine} />}
      bar={
        <>
          {/* The screening ahead of it, in the screening tint. */}
          <Track on={queued} total={job.waiting?.total ?? 0} parts={[{ n: job.waiting?.done ?? 0, className: "bg-[var(--kind-screening)]" }]} />
          {/* Included, excluded and unclear fill it from the left as papers are decided. */}
          <Track
            on={!queued}
            total={job.total}
            parts={[
              { n: job.included, className: "bg-emerald-500" },
              { n: job.excluded, className: "bg-slate-400/70" },
              { n: job.unclear, className: "bg-amber-400" },
            ]}
          />
        </>
      }
      legend={
        <>
          <motion.div {...fade(queued)} inert={!queued} className="flex min-w-0 items-center gap-2">
            <Hourglass className="size-3 shrink-0" />
            <span className="min-w-0 truncate">{job.waiting?.label ?? t("screening.waitingFor")}</span>
            {job.waiting?.total ? <span className="ml-auto shrink-0 tabular-nums">{t("of", { done: job.waiting.done, total: job.waiting.total })}</span> : null}
          </motion.div>
          <motion.div {...fade(!queued)} inert={queued} className="flex items-center gap-4">
            <span className="flex items-center gap-1"><Check className="size-3 text-emerald-600" /> <span className="tabular-nums">{job.included}</span> {t("included")}</span>
            <span className="flex items-center gap-1"><X className="size-3" /> <span className="tabular-nums">{job.excluded}</span> {t("excluded")}</span>
            <span className="flex items-center gap-1"><CircleHelp className="size-3 text-amber-600" /> <span className="tabular-nums">{job.unclear}</span> {t("unclear")}</span>
          </motion.div>
        </>
      }
    />
  );
}

/** An extraction: how many of its papers are read, and how many failed. The answers are on its page. */
export function ExtractionCard({ job, mine }: { job: Extraction; mine: boolean }) {
  const t = useTranslations("assistant.jobs");
  const cancel = useCancel(useMutation(api.extraction.mutations.jobs.cancelExtraction).bind(null, { jobId: job.jobId }));
  const running = RUNNING.has(job.status);
  const stopped = job.status === "creditsExhausted" || job.status === "paused";
  const read = job.done - job.failed;
  const title =
    job.status === "cancelled"
      ? t("extraction.cancelled", { done: job.done, total: job.total })
      : stopped
        ? t("extraction.stopped", { done: job.done, total: job.total })
        : job.status === "failed"
          ? t("extraction.failed")
          : running
            ? t("extraction.running", { count: job.total })
            : t("extraction.done", { count: job.total });
  return (
    <LiveCard
      kind="extraction"
      title={title}
      running={running}
      credits={job.credits}
      done={job.done}
      total={job.total}
      href={mine ? `/extraction/${job.jobId}` : null}
      end={<EndSlot running={running} status={job.status} capped={stopped} cancelLabel={t("extraction.cancel")} onCancel={cancel} mine={mine} />}
      bar={
        <Track
          total={job.total}
          parts={[
            { n: read, className: "bg-[var(--kind-extraction)]" },
            { n: job.failed, className: "bg-destructive/70" },
          ]}
        />
      }
      legend={
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1"><Check className="size-3 text-[var(--kind-extraction)]" /> <span className="tabular-nums">{read}</span> {t("read")}</span>
          {job.failed ? <span className="flex items-center gap-1"><CircleAlert className="size-3 text-destructive" /> <span className="tabular-nums">{job.failed}</span> {t("failedCount")}</span> : null}
        </div>
      }
    />
  );
}
