"use client";

// The live card of a job a reply started (#328): a screening fills its bar as papers are decided,
// an extraction fills each paper's answers as they're read. Each reads the job's own progress
// (convex/assistant/jobs.ts) and keeps one size from its first frame, whatever arrives.

import { createContext, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "@/components/workspace-link";
import { useTranslations } from "next-intl";
import { useQuery } from "convex/react";
import { useWorkspaceMutation } from "@/lib/workspaces/url";
import type { FunctionReturnType } from "convex/server";
import { animate, AnimatePresence, motion, useAnimationFrame, useMotionValue, useReducedMotion } from "motion/react";
import { Ban, Check, ChevronDown, CircleAlert, CircleHelp, Coins, ExternalLink, Hourglass, X } from "@/components/icons";
import { EASE } from "@/components/settings/model-map";
import { TooltipHint } from "@/components/ui/tooltip";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getErrorMessage, useAppToast } from "@/lib/toast/use-app-toast";
import { cn } from "@/lib/utils";
import { WorkingText } from "./parts";
import { KindTile } from "./steps";

type Read = NonNullable<FunctionReturnType<typeof api.assistant.jobs.card>>;
type Screening = Extract<Read["card"], { kind: "screening" }>;
type Extraction = Extract<Read["card"], { kind: "extraction" }>;

/** The actions that start a job: a step of one, once it ran, shows the job's card. */
export const JOB_STARTS = new Set(["screening/start:screen", "extraction/start:extract"]);

/** A job card's height, held from its first frame so the chat around it never moves. */
const JOB_CARD_H = 118;
const RUNNING = new Set(["processing", "pending", "downloading_pdfs", "indexing", "extracting"]);

/** A job's card, by the step that started it: its frame until the job is read. */
export function JobCard({ threadId, stepId }: { threadId: Id<"assistantThreads">; stepId: string }) {
  const read = useQuery(api.assistant.jobs.card, { threadId, stepId: stepId as Id<"assistantSteps"> });
  if (read === undefined) return <div className="rounded-2xl border border-border/60 bg-muted/40" style={{ height: JOB_CARD_H }} />;
  // A job deleted since: its frame folds away, so the chat under it closes up rather than jumps.
  if (read === null) return <motion.div aria-hidden initial={{ height: JOB_CARD_H, opacity: 1 }} animate={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="rounded-2xl bg-muted/40" />;
  return read.card.kind === "screening" ? <ScreeningCard job={read.card} mine={read.mine} /> : <ExtractionCard job={read.card} mine={read.mine} />;
}

/**
 * The steps whose jobs are running, whose cards the chat docks over its message box instead of
 * showing them under their steps, and the ones whose cards are flying from the dock to their
 * place in the chat, which holds its card back until it lands.
 */
export const DockedJobs = createContext<{ docked: ReadonlySet<string>; flying: ReadonlySet<string> }>({ docked: new Set(), flying: new Set() });

/** The spring a job's card moves on: into the dock, between its places in it, and back into the chat once it ends. */
export const CARD_SPRING = { type: "spring" as const, stiffness: 420, damping: 36 };
/** Each card's name for motion in the dock, shared by its place in the folded stack and in the opened list, so it moves between them. */
const cardLayoutId = (stepId: string) => `dock:${stepId}`;

const GAP = 8;
/** How far each card behind the front one shows above it while the stack is folded. */
const PEEK = 16;
/** Cards a folded stack shows edges of, behind the front one. */
const PEEKING = 2;

/** The dock's height: a folded stack is its front card with the edges of the ones behind, and the gap over the message box. */
const dockHeight = (count: number) => (count === 0 ? 0 : JOB_CARD_H + Math.min(count - 1, PEEKING) * PEEK + GAP);

/** Cards the opened list shows before it scrolls: the half card under the last says there are more. */
const LISTED = 3.5;

/**
 * The chat's running jobs, docked right over the message box as live activities sit on a lock
 * screen; the chips sit over them. One shows whole. More fold into a stack, newest in front,
 * which a tap opens upward into a list over the chat, scrolling past three and a half cards. A
 * job that ends leaves the dock and flies to its place in the chat, under the steps that
 * started it.
 */
export function JobDock({ threadId, jobs, open, onOpen }: { threadId: Id<"assistantThreads">; jobs: { stepId: string }[]; open: boolean; onOpen: (open: boolean) => void }) {
  const t = useTranslations("assistant.jobs");
  const reduceMotion = useReducedMotion();
  const spring = reduceMotion ? { duration: 0 } : CARD_SPRING;
  const stacked = jobs.length > 1;
  const opened = open && stacked;
  // Opening or folding it from the keyboard takes focus along: into the list, or back to the stack it came from.
  const refocus = useRef(false);
  const toggle = (open: boolean, byKeyboard: boolean) => {
    refocus.current = byKeyboard;
    onOpen(open);
  };
  const focusIfAsked = (element: HTMLElement | null) => {
    if (element && refocus.current) {
      refocus.current = false;
      element.focus();
    }
  };
  const card = (stepId: string, inert: boolean) => (
    <div inert={inert} aria-hidden={inert || undefined} className="h-full">
      <JobCard threadId={threadId} stepId={stepId} />
    </div>
  );
  return (
    // Only the folded stack takes room: the opened list rises over the chips and the chat.
    <motion.div className="relative z-20" initial={false} animate={{ height: dockHeight(jobs.length) }} transition={spring}>
      {opened ? (
        <div
          className="absolute inset-x-0 flex flex-col items-end gap-2"
          style={{ bottom: GAP }}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            toggle(false, true);
          }}
        >
          <motion.button
            type="button"
            ref={focusIfAsked}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: EASE }}
            // A click from the keyboard has no pointer behind it (`detail` 0).
            onClick={(event) => toggle(false, event.detail === 0)}
            className="flex h-7 shrink-0 items-center gap-1 rounded-full bg-card px-3 text-xs font-medium text-foreground/80 shadow-xs ring-1 ring-border/60 hover:text-foreground"
          >
            {t("showLess")} <ChevronDown className="size-3" />
          </motion.button>
          {/* Newest at the bottom, where the stack's front card was; the list scrolls up through the older ones. */}
          <motion.div layoutScroll className="scrollbar-hover flex w-full flex-col-reverse gap-2 overflow-y-auto overscroll-contain" style={{ maxHeight: `min(${Math.round(LISTED * (JOB_CARD_H + GAP))}px, calc(100dvh - 22rem))` }}>
            {jobs.map((job) => (
              <motion.div key={job.stepId} data-job-card={job.stepId} layoutId={cardLayoutId(job.stepId)} transition={spring} className="shrink-0 rounded-2xl bg-card shadow-[0_10px_30px_-12px_rgb(0_0_0/0.35)]" style={{ height: JOB_CARD_H }}>
                {card(job.stepId, false)}
              </motion.div>
            ))}
          </motion.div>
        </div>
      ) : (
        // Cards already here when the stack shows (the chat opening, the list folding) are in place; a job started after rises in.
        <AnimatePresence initial={false}>
        {jobs.map((job, i) => {
          // The front card at the bottom, each one behind it a step up and a step smaller.
          // Past the edges the stack shows, a card sits hidden behind the last one and takes no clicks.
          const depth = Math.min(i, PEEKING);
          const hidden = i > PEEKING;
          const behind = i > 0;
          return (
            <motion.div
              key={job.stepId}
              data-job-card={job.stepId}
              layoutId={cardLayoutId(job.stepId)}
              className={cn("absolute inset-x-0 origin-top rounded-2xl bg-card shadow-[0_10px_30px_-12px_rgb(0_0_0/0.35)]", stacked && "cursor-pointer", hidden && "pointer-events-none")}
              style={{ height: JOB_CARD_H, bottom: GAP, zIndex: jobs.length - i }}
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ y: -depth * PEEK, scale: 1 - depth * 0.05, opacity: hidden ? 0 : 1 }}
              // It leaves at once: a copy of it flies to its place in the chat (JobFlight).
              exit={{ opacity: 0, transition: { duration: 0 } }}
              transition={spring}
              onClickCapture={(event) => {
                // A tap anywhere on a stack but a link or a button opens it.
                if (!stacked || (event.target as HTMLElement).closest("a,button")) return;
                event.stopPropagation();
                toggle(true, false);
              }}
            >
              {/* The front card names the rest, and a keyboard opens the stack from it. */}
              {stacked && i === 0 ? (
                <button
                  type="button"
                  ref={focusIfAsked}
                  onClick={(event) => toggle(true, event.detail === 0)}
                  className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:bottom-2 focus-visible:left-1/2 focus-visible:z-10 focus-visible:-translate-x-1/2 focus-visible:whitespace-nowrap focus-visible:rounded-full focus-visible:bg-card focus-visible:px-3 focus-visible:py-1 focus-visible:text-xs focus-visible:font-medium focus-visible:shadow-xs focus-visible:ring-1 focus-visible:ring-border/60">
                  {t("showAll", { count: jobs.length })}
                </button>
              ) : null}
              {card(job.stepId, behind)}
            </motion.div>
          );
        })}
        </AnimatePresence>
      )}
    </motion.div>
  );
}

/** A card leaving the dock, from where it was. */
export type Flight = { stepId: string; from: DOMRect };

/**
 * A card that left the dock as its job ended, flying to its place in the chat on a layer over
 * the panel: inside the chat's scroller it would make the chat taller while it was still below
 * it, and the chat would scroll after it. It follows its place each frame, which opens as it
 * flies, so it lands on it whatever the chat does meanwhile. A place out of sight gets no
 * flight: the card fades where it was.
 */
export function JobFlight({ threadId, flight, layer, onLanded }: { threadId: Id<"assistantThreads">; flight: Flight; layer: RefObject<HTMLDivElement | null>; onLanded: () => void }) {
  const card = useRef<HTMLDivElement>(null);
  const progress = useMotionValue(0);
  // Whether its place was in sight as it left, decided on its first frame.
  const [aim, setAim] = useState<"slot" | "fade" | null>(null);
  const place = () => document.querySelector<HTMLElement>(`[data-job-slot="${flight.stepId}"]`);
  // A layout read and an animation frame: whether its place is in sight as it leaves, then its flight, which each frame follows that place.
  useLayoutEffect(() => {
    const slot = place();
    const scroller = slot?.closest<HTMLElement>("[role='log']");
    const at = slot?.getBoundingClientRect();
    const view = scroller?.getBoundingClientRect();
    const seen = at && view && at.top >= view.top && at.top + JOB_CARD_H <= view.bottom + JOB_CARD_H / 2;
    setAim(seen ? "slot" : "fade");
    // From the frame it's first drawn on, so a busy frame as the dock changes doesn't start it partway.
    let controls: ReturnType<typeof animate> | undefined;
    const frame = requestAnimationFrame(() => {
      controls = animate(progress, 1, { ...(seen ? CARD_SPRING : { duration: 0.25, ease: EASE }), onComplete: onLanded });
    });
    return () => {
      cancelAnimationFrame(frame);
      controls?.stop();
    };
    // Measured once, as it leaves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useAnimationFrame(() => {
    const element = card.current;
    const base = layer.current?.getBoundingClientRect();
    if (!element || !base || aim === null) return;
    const p = progress.get();
    if (aim === "fade") {
      element.style.transform = `translate(${flight.from.left - base.left}px, ${flight.from.top - base.top}px) scale(${1 - 0.04 * p})`;
      element.style.opacity = String(1 - p);
      return;
    }
    const slot = place()?.getBoundingClientRect();
    if (!slot) return;
    // The card sits under its place's gap (pt-3).
    const top = flight.from.top + (slot.top + GAP_ABOVE - flight.from.top) * p;
    const left = flight.from.left + (slot.left - flight.from.left) * p;
    element.style.width = `${flight.from.width + (slot.width - flight.from.width) * p}px`;
    element.style.transform = `translate(${left - base.left}px, ${top - base.top}px)`;
  });
  return (
    <div
      ref={card}
      className="absolute left-0 top-0 rounded-2xl bg-card shadow-[0_10px_30px_-12px_rgb(0_0_0/0.35)]"
      style={{ height: JOB_CARD_H, width: flight.from.width, transform: `translate(-9999px, 0)` }}
    >
      <JobCard threadId={threadId} stepId={flight.stepId} />
    </div>
  );
}

/** The gap a card's place in the chat holds above it. */
const GAP_ABOVE = 12;

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
    <div className="rounded-2xl border border-border/60 bg-muted/40 p-4" style={{ height: JOB_CARD_H }}>
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
function ScreeningCard({ job, mine }: { job: Screening; mine: boolean }) {
  const t = useTranslations("assistant.jobs");
  const cancel = useCancel(useWorkspaceMutation(api.screening.mutations.cancelScreeningJob).bind(null, { jobId: job.jobId }));
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
function ExtractionCard({ job, mine }: { job: Extraction; mine: boolean }) {
  const t = useTranslations("assistant.jobs");
  const cancel = useCancel(useWorkspaceMutation(api.extraction.mutations.cancelExtraction).bind(null, { jobId: job.jobId }));
  const running = RUNNING.has(job.status);
  const stopped = job.status === "creditsExhausted" || job.status === "paused";
  // `done` counts the papers it answered; a paper that failed is counted apart, and both are finished.
  const finished = job.done + job.failed;
  const title =
    job.status === "cancelled"
      ? t("extraction.cancelled", { done: finished, total: job.total })
      : stopped
        ? t("extraction.stopped", { done: finished, total: job.total })
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
      done={finished}
      total={job.total}
      href={mine ? `/extraction/${job.jobId}` : null}
      end={<EndSlot running={running} status={job.status} capped={stopped} cancelLabel={t("extraction.cancel")} onCancel={cancel} mine={mine} />}
      bar={
        <Track
          total={job.total}
          parts={[
            { n: job.done, className: "bg-[var(--kind-extraction)]" },
            { n: job.failed, className: "bg-destructive/70" },
          ]}
        />
      }
      legend={
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1"><Check className="size-3 text-[var(--kind-extraction)]" /> <span className="tabular-nums">{job.done}</span> {t("read")}</span>
          {job.failed ? <span className="flex items-center gap-1"><CircleAlert className="size-3 text-destructive" /> <span className="tabular-nums">{job.failed}</span> {t("failedCount")}</span> : null}
        </div>
      }
    />
  );
}
