"use client";

// The live card of a job a reply started (#328): a screening fills its bar as papers are decided,
// an extraction fills each paper's answers as they're read. Each reads the job's own progress
// (convex/assistant/jobs.ts) and keeps one size from its first frame, whatever arrives.

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { motion, useReducedMotion } from "motion/react";
import { Ban, Check, CircleAlert, CircleHelp, Coins, ExternalLink, Hourglass, Type, X } from "@/components/icons";
import { Segmented } from "@/components/settings/parts";
import { EASE } from "@/components/settings/model-map";
import { TooltipHint } from "@/components/ui/tooltip";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getErrorMessage, useAppToast } from "@/lib/toast/use-app-toast";
import { cn } from "@/lib/utils";
import { WorkingText } from "./parts";
import { KIND, KindTile } from "./steps";

type Read = NonNullable<FunctionReturnType<typeof api.assistant.jobs.card>>;
type Screening = Extract<Read["card"], { kind: "screening" }>;
type Extraction = Extract<Read["card"], { kind: "extraction" }>;

/** The actions that start a job: a step of one, once it ran, shows the job's card. */
export const JOB_STARTS = new Set(["screening/start:screen", "extraction/start:extract"]);

/** The screening card's height, held from its first frame so the chat below it never moves. */
const SCREENING_H = 118;
const RUNNING = new Set(["processing", "pending", "downloading_pdfs", "indexing", "extracting"]);

/** An extraction's frame until its progress arrives: its header and question row. */
const EXTRACTION_H = 120;

/** A job's card, by the step that started it. */
export function JobCard({ threadId, stepId, kind }: { threadId: Id<"assistantThreads">; stepId: string; kind: "screening" | "extraction" }) {
  const read = useQuery(api.assistant.jobs.card, { threadId, stepId: stepId as Id<"assistantSteps"> });
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }}>
      <Grows from={kind === "screening" ? SCREENING_H : EXTRACTION_H}>
        {read === undefined ? (
          // Its frame until the job's progress arrives.
          <div className="rounded-2xl border border-border/60 bg-muted/40" style={{ height: kind === "screening" ? SCREENING_H : EXTRACTION_H }} />
        ) : read === null ? null : read.card.kind === "screening" ? (
          <ScreeningCard job={read.card} mine={read.mine} />
        ) : (
          <ExtractionCard job={read.card} mine={read.mine} />
        )}
      </Grows>
    </motion.div>
  );
}

/**
 * A frame that takes its content's height by animating to it, so a card whose size is only
 * known once its job is read grows into it instead of pushing the chat below it at once.
 */
function Grows({ from, children }: { from: number; children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(from);
  const reduceMotion = useReducedMotion();
  // A ResizeObserver: the content's height changes as the job's rows arrive.
  useEffect(() => {
    const element = inner.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <motion.div className="overflow-hidden" initial={false} animate={{ height }} transition={reduceMotion ? { duration: 0 } : { duration: 0.35, ease: EASE }}>
      <div ref={inner}>{children}</div>
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

/**
 * A screening. It first waits while the person's other papers take their slots, then fills in
 * as papers are decided. Waiting and running share one frame, cross-fading their bar and
 * legend, so the card never changes size.
 */
function ScreeningCard({ job, mine }: { job: Screening; mine: boolean }) {
  const t = useTranslations("assistant.jobs");
  const cancel = useCancel(useMutation(api.screening.mutations.cancelScreeningJob).bind(null, { jobId: job.jobId }));
  const done = job.included + job.excluded + job.unclear + job.failed;
  const running = RUNNING.has(job.status);
  const queued = running && job.waiting !== undefined;
  const stopped = job.capped || job.status === "creditsExhausted";
  const seg = (n: number) => `${job.total ? (n / job.total) * 100 : 0}%`;
  const fade = (on: boolean) => ({ initial: false as const, animate: { opacity: on ? 1 : 0 }, transition: { duration: 0.3, ease: EASE } });
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
    <div className="rounded-2xl border border-border/60 bg-muted/40 p-4" style={{ height: SCREENING_H }}>
      <div className="flex items-center gap-3">
        <KindTile kind="screening" working={running} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{running ? <WorkingText>{title}</WorkingText> : title}</p>
          <Credits credits={job.credits} />
        </div>
        <span className="text-sm font-semibold tabular-nums">
          {done}
          <span className="font-normal text-muted-foreground"> / {job.total}</span>
        </span>
        <EndSlot running={running} status={job.status} capped={stopped} cancelLabel={t("screening.cancel")} onCancel={cancel} mine={mine} />
      </div>
      <div className="mt-3 grid h-2 [&>*]:col-start-1 [&>*]:row-start-1">
        {/* The screening ahead of it, in the screening tint. */}
        <motion.div {...fade(queued)} className="h-2 overflow-hidden rounded-full bg-foreground/10">
          <motion.span
            className="block h-full rounded-full"
            style={{ backgroundColor: KIND.screening.tint }}
            initial={false}
            animate={{ width: `${job.waiting?.total ? (job.waiting.done / job.waiting.total) * 100 : 0}%` }}
            transition={{ duration: 0.25, ease: EASE }}
          />
        </motion.div>
        {/* One track: included, excluded and unclear fill it from the left as papers are decided. */}
        <motion.div {...fade(!queued)} className="flex h-2 overflow-hidden rounded-full bg-foreground/10">
          <motion.span className="h-full bg-emerald-500" initial={false} animate={{ width: seg(job.included) }} transition={{ duration: 0.3, ease: EASE }} />
          <motion.span className="h-full bg-slate-400/70" initial={false} animate={{ width: seg(job.excluded) }} transition={{ duration: 0.3, ease: EASE }} />
          <motion.span className="h-full bg-amber-400" initial={false} animate={{ width: seg(job.unclear) }} transition={{ duration: 0.3, ease: EASE }} />
        </motion.div>
      </div>
      <div className="mt-2.5 flex items-center gap-4 text-xs text-muted-foreground">
      <div className="grid min-w-0 flex-1 [&>*]:col-start-1 [&>*]:row-start-1">
        <motion.div {...fade(queued)} inert={!queued} className="flex min-w-0 items-center gap-2">
          <Hourglass className="size-3 shrink-0" />
          <span className="min-w-0 truncate">{job.waiting?.label ?? t("screening.waitingFor")}</span>
          {job.waiting?.total ? (
            <span className="ml-auto shrink-0 tabular-nums">{t("of", { done: job.waiting.done, total: job.waiting.total })}</span>
          ) : null}
        </motion.div>
        <motion.div {...fade(!queued)} inert={queued} className="flex items-center gap-4">
          <span className="flex items-center gap-1"><Check className="size-3 text-emerald-600" /> <span className="tabular-nums">{job.included}</span> {t("included")}</span>
          <span className="flex items-center gap-1"><X className="size-3" /> <span className="tabular-nums">{job.excluded}</span> {t("excluded")}</span>
          <span className="flex items-center gap-1"><CircleHelp className="size-3 text-amber-600" /> <span className="tabular-nums">{job.unclear}</span> {t("unclear")}</span>
        </motion.div>
      </div>
        {/* Its page shows a job to its owner alone. */}
        {mine ? (
          <Link href={`/screening?job=${job.jobId}`} className="flex shrink-0 items-center gap-1 font-medium text-foreground/80 hover:text-foreground">
            {t("open")} <ExternalLink className="size-3" />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/**
 * An extraction, read one question at a time: pick one, and the job's first papers line up
 * under it for comparison. Each row holds the height of its longest answer, so switching
 * questions or answers arriving never moves it.
 */
function ExtractionCard({ job, mine }: { job: Extraction; mine: boolean }) {
  const t = useTranslations("assistant.jobs");
  const cancel = useCancel(useMutation(api.extraction.mutations.jobs.cancelExtraction).bind(null, { jobId: job.jobId }));
  const [picked, setPicked] = useState<string | null>(null);
  const question = picked ?? job.questions[0]?.key ?? "";
  const running = RUNNING.has(job.status);
  const stopped = job.status === "creditsExhausted" || job.status === "paused";
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
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-muted/40">
      <div className="flex items-center gap-3 p-4 pb-3">
        <KindTile kind="extraction" working={running} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{running ? <WorkingText>{title}</WorkingText> : title}</p>
          <Credits credits={job.credits} />
        </div>
        <EndSlot running={running} status={job.status} capped={stopped} cancelLabel={t("extraction.cancel")} onCancel={cancel} mine={mine} />
        {mine ? (
          <Link href={`/extraction/${job.jobId}`} className="flex items-center gap-1 text-xs font-medium text-foreground/80 hover:text-foreground">
            {t("open")} <ExternalLink className="size-3" />
          </Link>
        ) : null}
      </div>
      <div className="px-3 pb-3">
        {/* Every question, none cut: past the card's width the row scrolls sideways. */}
        <div className="overflow-x-auto scrollbar-hover">
          <Segmented label={t("question")} value={question} onChange={setPicked} options={job.questions.map((asked) => ({ id: asked.key, label: asked.question }))} />
        </div>
        <ol className="mt-2 space-y-0.5">
          {job.rows.map((row, r) => (
            <li key={row.id} className="flex gap-3 rounded-xl px-2 py-2.5">
              <span className="flex h-5 items-center">
                <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-md px-1 text-[11px] font-semibold tabular-nums" style={{ backgroundColor: `color-mix(in oklab, ${KIND.extraction.tint} 18%, transparent)`, color: KIND.extraction.tint }}>
                  {r + 1}
                </span>
              </span>
              <div className="min-w-0 flex-1">
                {/* Every question's answer shares one cell; only the picked one shows. */}
                <div className="grid h-[2lh] text-sm leading-snug [&>*]:col-start-1 [&>*]:row-start-1">
                  {job.questions.map((asked) => {
                    // Over, with no answer to this question: it isn't coming.
                    const answer = row.answers[asked.key] ?? (running ? undefined : { text: "", missing: true, none: true });
                    const on = asked.key === question;
                    return (
                      <div key={asked.key} className="relative" aria-hidden={!on}>
                        <motion.span
                          initial={false}
                          animate={{ opacity: on && answer ? 1 : 0, y: on && answer ? 0 : 3 }}
                          transition={{ duration: 0.25, ease: EASE }}
                          className={cn("line-clamp-2 [overflow-wrap:anywhere]", answer?.missing ? "italic text-muted-foreground" : "font-medium text-foreground")}
                        >
                          {answer ? (answer.missing ? t("none" in answer ? "noAnswer" : "missing") : answer.text) : " "}
                        </motion.span>
                        <motion.span aria-hidden initial={false} animate={{ opacity: on && !answer ? 1 : 0 }} transition={{ duration: 0.15 }} className="absolute left-0 top-1 h-3 w-3/5 rounded-full bg-foreground/[0.07]" />
                      </div>
                    );
                  })}
                </div>
                <p className="mt-1 flex h-[18px] min-w-0 items-center gap-2 text-xs text-muted-foreground">
                  <span className="truncate">{row.title}</span>
                  {row.titleOnly && row.done ? (
                    <motion.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3, ease: EASE }} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-foreground/[0.06] px-1.5 py-px text-[11px] font-medium text-muted-foreground">
                      <Type className="size-3" /> {t("titleOnly")}
                    </motion.span>
                  ) : null}
                </p>
              </div>
            </li>
          ))}
        </ol>
        {job.total > job.rows.length ? <p className="px-2 pt-1 text-xs text-muted-foreground">{t("more", { count: job.total - job.rows.length })}</p> : null}
      </div>
    </div>
  );
}
