"use client";

// What the assistant did in a reply, drawn like the AI settings routing map: a tile at the
// top, a tinted curve out to each step's card, one card per action it ran. An action it
// asks the person about first shows under the map as the mock's approval card.

import { createContext, useContext, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, Check, ChevronDown, CircleAlert, Coins, Compass, FileText, FolderPlus, ListChecks, MessagesSquare, Plus, Search, TableProperties, Undo2, X, type AppIcon } from "@/components/icons";
import { AnimatedNumber } from "@/components/screening/parts";
import { Button } from "@/components/ui/button";
import { TooltipHint } from "@/components/ui/tooltip";
import { EASE } from "@/components/settings/model-map";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { STEPS_SHOWN } from "@/lib/assistant/steps";
import { getErrorMessage, useAppToast } from "@/lib/toast/use-app-toast";
import { cn } from "@/lib/utils";
import { viewOf, type Kind } from "@/lib/assistant/actions";
import { OrbitMark } from "./orbit-mark";
import { WorkingText } from "./parts";

type Item = FunctionReturnType<typeof api.assistant.replies.messages>["page"][number];
export type StepItem = Extract<Item, { role: "step" }>;

/** One tint per kind of work, the way the model map gives each provider one. */
const KIND = {
  search: { icon: Search, tint: "#60a5fa" },
  paper: { icon: FileText, tint: "#eab308" },
  collection: { icon: FolderPlus, tint: "#2dd4bf" },
  screening: { icon: ListChecks, tint: "#a78bfa" },
  extraction: { icon: TableProperties, tint: "#fb923c" },
  chat: { icon: MessagesSquare, tint: "#f472b6" },
  other: { icon: Compass, tint: "#94a3b8" },
} satisfies Record<string, { icon: AppIcon; tint: string }>;

const CARD = 56;
const GAP = 8;
const GUTTER = 36;
/** Room at the top for the tile the curves start from. */
const ORIGIN = 28;
/** One step of a folded run, as a line under its card. */
const LINE = 28;
/** Room under a folded run's lines. */
const LINES_END = 8;

/** A tinted icon square; the tile of the model cards, one size down. */
export function KindTile({ kind, working }: { kind: Kind; working?: boolean }) {
  const { icon: Icon, tint } = KIND[kind];
  const reduceMotion = useReducedMotion();
  return (
    <motion.span
      animate={working && !reduceMotion ? { scale: [1, 1.08, 1] } : { scale: 1 }}
      transition={working ? { duration: 1.1, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
      className="flex size-9 shrink-0 items-center justify-center rounded-xl"
      style={{ backgroundColor: `color-mix(in oklab, ${tint} 18%, transparent)`, color: tint }}
    >
      <Icon className="size-4" />
    </motion.span>
  );
}

/** A fact on a card: a number and a short label, instead of a sentence. */
function Fact({ value, children }: { value?: ReactNode; children: ReactNode }) {
  return (
    <span className="flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-foreground/[0.06] px-1.5 text-[11px] text-muted-foreground">
      {value !== undefined ? <span className="font-semibold tabular-nums text-foreground/90">{value}</span> : null}
      {children}
    </span>
  );
}

/**
 * The steps of one reply. They hang off a small tile at the top, the way the settings map
 * runs a curve from each task to its model. Each card is as tall as the next, and the map
 * grows by a card as a step starts, so nothing above it moves. The same step again is the
 * same card, counted (`runsOf`).
 */
export function Steps({
  threadId,
  steps: newest,
}: {
  threadId: Id<"assistantThreads">;
  /** The reply's steps as the chat's page holds them, in the order they ran: the newest of each exchange it ran in. */
  steps: StepItem[];
}) {
  // An exchange that ran more than the page holds has the ones before them a page away. Reading them here also
  // keeps the ones the page lets go of as the reply runs on, so no card leaves the map: the read starts at half
  // a page, well before the page lets any go. It runs from the reply's first exchange through its last, which
  // only changes when a reply still running carries on in a new one.
  const ran = new Map<number, number>();
  for (const step of newest) ran.set(step.order, (ran.get(step.order) ?? 0) + 1);
  const cut = [...ran.values()].some((count) => count >= STEPS_SHOWN / 2);
  const range = { order: Math.min(...ran.keys()), through: Math.max(...ran.keys()) };
  const { results, status, loadMore } = usePaginatedQuery(api.assistant.replies.steps, cut ? { threadId, ...range } : "skip", { initialNumItems: STEPS_SHOWN });
  // In the order they ran, whichever page brought them. The page's copy of a step is the one kept: it says what a step that waits for the person would do.
  const all = [...new Map([...results.toReversed(), ...newest].map((step) => [step.id, step])).values()].sort((a, b) => a.order - b.order || a.at - b.at);
  const asked = all.filter((step) => step.canAnswer);
  const steps = all.filter((step) => !step.canAnswer);
  return (
    <div className="space-y-3">
      {steps.length ? <RunMap threadId={threadId} steps={steps} earlier={status === "CanLoadMore" ? () => loadMore(STEPS_SHOWN) : status === "LoadingMore" ? "loading" : null} /> : null}
      <AnimatePresence initial={false}>
        {asked.map((step) => (
          <ApprovalCard key={step.id} threadId={threadId} step={step} />
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Names of a call's arguments the card says in the person's language; any other shows as the action names it. */
const NAMED = ["thread", "collection", "user", "organization", "role", "name", "title", "model", "search", "screening", "papers", "first", "last", "question", "saveTo", "prune"] as const;

/** Arguments that are a setting turned on or off. */
const SWITCHES = new Set(["prune", "inCollection", "usePdfs", "openAccessOnly", "withAbstractOnly", "reviewsOnly", "includeRetracted", "ratedOnly"]);

/** What the credits a card's top-up is for: the call that waits, as the Add credits sheet names it. */
export type Waiting = { kind: Kind; title: string; credits: number };
/** Opens the Add credits sheet over the panel, for a call that waits on a balance too low for it. */
export const AddCredits = createContext<(waiting: Waiting) => void>(() => {});

/**
 * A step's title. One that waits for an answer, or was allowed or not, hasn't happened: it's
 * named as what was asked, then as what it's doing, then as what it did. A bulk change is one
 * step, and says how many: how many it's for until it's done, then how many it made. A kind
 * of action with no words of its own for a form takes the general ones.
 */
function useStepTitle() {
  const t = useTranslations("assistant");
  return (words: string, step: Pick<StepItem, "status" | "batch" | "count">) => {
    const form = step.status === "asking" || step.status === "allowed" || step.status === "declined" ? "ask" : step.status === "running" || step.status === "failed" ? "doing" : "did";
    const many = step.batch === undefined ? "" : "Many";
    const own = `steps.${words}.${form}${many}` as "steps.other.askMany";
    return t(t.has(own) ? own : (`steps.other.${form}${many}` as "steps.other.askMany"), { count: (form === "did" ? step.count : undefined) ?? step.batch ?? 1 });
  };
}

/**
 * Asks before a change that can't be undone or that shows outside the account: what it
 * would do, with the records it names, then Allow once or Not now. One that spends credits
 * (#328) asks with the most it holds against the person's balance, and can be allowed for
 * the rest of the chat. A bulk change asks once for all of it, with the first of the records
 * it's made to and how many more there are. The mock's approval card.
 */
function ApprovalCard({ threadId, step }: { threadId: Id<"assistantThreads">; step: StepItem }) {
  const t = useTranslations("assistant");
  const answer = useMutation(api.assistant.replies.answer);
  const toast = useAppToast();
  // Pressed once: the buttons rest until the chat shows the answer, or says it couldn't be sent.
  const [sent, setSent] = useState(false);
  const { kind, words } = viewOf(step.action, step.variant);
  const addCredits = useContext(AddCredits);
  const common = useTranslations("common");
  const heading = useStepTitle()(words, step);
  /** A value as the card says it: a setting that is on or off as yes or no, not as the action writes it. A name that happens to read "true" stays as typed. */
  const said = ({ name, value }: { name: string; value: string }) => (SWITCHES.has(name) && (value === "true" || value === "false") ? common(value === "true" ? "yes" : "no") : value);
  const each = step.each ?? [];
  /** An argument's name in the person's language, where the card has one; any other shows as the action names it. */
  const named = (name: string) => ((NAMED as readonly string[]).includes(name) ? t(`asks.names.${name as (typeof NAMED)[number]}`) : name);
  const say = (allow: boolean, always?: boolean) => {
    setSent(true);
    answer({ threadId, stepId: step.id as Id<"assistantSteps">, allow, ...(always ? { always } : {}) }).catch((error) => {
      setSent(false);
      toast.error(t("asks.failed"), getErrorMessage(error, ""));
    });
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
      className="overflow-hidden rounded-2xl border border-primary/30 bg-primary/[0.04]"
    >
      <div className="flex items-start gap-3 p-4">
        <KindTile kind={kind} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{heading}</p>
          <ul className="mt-1.5 space-y-1 text-sm text-muted-foreground empty:hidden">
            {(step.details ?? []).map((detail, i) => (
              <li key={i} className="flex gap-2">
                <span className="shrink-0 text-foreground/50">{named(detail.name)}</span>
                {/* What someone may do in a shared chat, in the Share sheet's own words. A record with nothing to call it by, such as a search saved with filters alone, says so. */}
                <span className="min-w-0 break-words">{detail.name === "role" && (detail.value === "read" || detail.value === "write") ? t(detail.value === "read" ? "canView" : "canChat") : said(detail) || t("asks.unnamed")}</span>
              </li>
            ))}
          </ul>
          {each.length ? (
            <ol className="mt-1.5 space-y-1 text-sm text-muted-foreground">
              {/* Each change: the record it's made to, then what it alone gives it, such as a new name. */}
              {each.map(([record, ...given], i) => (
                <li key={i} className="flex min-w-0 gap-2">
                  <span className="min-w-0 truncate">{record?.value || t("asks.unnamed")}</span>
                  {given.map((detail) => (
                    <span key={detail.name} className="flex min-w-0 max-w-[50%] shrink-0 gap-1">
                      <span className="shrink-0 text-foreground/50">{named(detail.name)}</span>
                      <span className="truncate">{said(detail)}</span>
                    </span>
                  ))}
                </li>
              ))}
              {step.batch !== undefined && step.batch > each.length ? <li className="text-foreground/50">{t("asks.more", { count: step.batch - each.length })}</li> : null}
            </ol>
          ) : null}
        </div>
        <TooltipHint label={t("asks.decline")}>
          <button
            type="button"
            aria-label={t("asks.decline")}
            disabled={sent}
            onClick={() => say(false)}
            className="-mr-1 -mt-1 flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <X className="size-4" />
          </button>
        </TooltipHint>
      </div>
      {step.credits === undefined ? (
        <>
          <p className="px-4 pb-4 text-xs text-muted-foreground">{t(step.batch === undefined ? "asks.why" : "asks.whyMany")}</p>
          <div className="grid grid-cols-[1fr_auto] gap-2 border-t border-primary/15 p-3">
            <Button className="h-9" disabled={sent} onClick={() => say(true)}>
              {t("asks.allow")}
            </Button>
            <Button className="h-9 px-4" variant="secondary" disabled={sent} onClick={() => say(false)}>
              {t("asks.notNow")}
            </Button>
          </div>
        </>
      ) : (
        <Spending credits={step.credits} sent={sent} onAllow={() => say(true)} onAlways={() => say(true, true)} onDecline={() => say(false)} onAddCredits={() => addCredits({ kind, title: heading, credits: step.credits! })} />
      )}
    </motion.div>
  );
}

/**
 * The part of an approval card for a call that spends credits: the most it holds against the
 * person's balance, then Allow once or Always allow in this chat. When the balance can't
 * cover it, the buttons turn into a top-up, and turn back once the credits land.
 */
function Spending({ credits, sent, onAllow, onAlways, onDecline, onAddCredits }: { credits: number; sent: boolean; onAllow: () => void; onAlways: () => void; onDecline: () => void; onAddCredits: () => void }) {
  const t = useTranslations("assistant.asks");
  const account = useQuery(api.billing.accounts.mine, {});
  // Until the balance is read, nothing is said about it, and the row keeps its room.
  const known = account !== undefined;
  const balance = Math.floor(account?.balance ?? 0);
  const short = known && credits > balance;
  // The bar is the balance; the filled part is what this takes from it.
  const share = known ? Math.min(1, credits / Math.max(balance, 1)) : 0;
  return (
    <>
      <div className="space-y-2 px-4 pb-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Coins className="size-3.5 text-primary" />
          <span className="font-medium text-foreground">{t("upTo", { credits })}</span>
          <span className={cn("ml-auto flex items-center gap-1.5 transition-opacity duration-200", !known && "opacity-0")} aria-hidden={!known}>
            <AnimatedNumber value={balance} />
            <ArrowRight className="size-3" />
            {/* Both labels hold their place, so the row never reflows when the balance changes. */}
            <span className="grid font-medium [&>*]:col-start-1 [&>*]:row-start-1 [&>*]:text-right">
              <motion.span initial={false} animate={{ opacity: short ? 1 : 0 }} aria-hidden={!short} className="tabular-nums text-amber-600 dark:text-amber-400">
                {t("short", { credits: Math.max(0, credits - balance) })}
              </motion.span>
              <motion.span initial={false} animate={{ opacity: short ? 0 : 1 }} aria-hidden={short} className="text-foreground">
                {t.rich("left", { n: () => <AnimatedNumber value={Math.max(0, balance - credits)} /> })}
              </motion.span>
            </span>
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
          <motion.span
            className={cn("block h-full rounded-full", short ? "bg-amber-400" : "bg-primary")}
            initial={false}
            animate={{ width: `${share * 100}%` }}
            transition={{ type: "spring", stiffness: 170, damping: 26 }}
          />
        </div>
      </div>
      {/* The two sets of buttons share one cell and cross-fade, so the card keeps its height. */}
      <div className="grid border-t border-primary/15 p-3 [&>*]:col-start-1 [&>*]:row-start-1">
        {/* Two equal buttons side by side, with little padding so the English pair fits the panel. In a language where one doesn't fit its half, each takes a line of its own: a yes is never cut short.
            Neither can be pressed until the balance is read, since a yes the balance can't cover is refused. */}
        <motion.div initial={false} animate={{ opacity: short ? 0 : 1, scale: short ? 0.98 : 1 }} transition={{ duration: 0.25, ease: EASE }} inert={short} className="flex flex-wrap gap-2">
          <Button className="h-9 min-w-max flex-[1_1_calc(50%-0.25rem)] px-2" disabled={sent || !known} onClick={onAllow}>
            {t("allow")}
          </Button>
          <Button className="h-9 min-w-max flex-[1_1_calc(50%-0.25rem)] px-2" variant="secondary" disabled={sent || !known} onClick={onAlways}>
            {t("always")}
          </Button>
        </motion.div>
        <motion.div initial={false} animate={{ opacity: short ? 1 : 0, scale: short ? 1 : 0.98 }} transition={{ duration: 0.25, ease: EASE }} inert={!short} className="grid grid-cols-[1fr_auto] gap-2">
          {/* Answered already, it has nothing left to add credits for. */}
          <Button className="h-9 gap-1.5" disabled={sent} onClick={onAddCredits}>
            <Plus className="size-4" /> {t("addCredits")}
          </Button>
          <Button className="h-9 px-4" variant="secondary" disabled={sent} onClick={onDecline}>
            {t("notNow")}
          </Button>
        </motion.div>
      </div>
    </>
  );
}

/** Whether a step leaves its card nothing to press and nothing to read but that it ran: no undo, no error, no answer it waits for, no credits. */
const folds = (step: StepItem) => (step.status === "done" || step.status === "running") && !step.canUndo && !step.undone && !step.error && step.batch === undefined && step.credits === undefined;

/**
 * The steps as the map's cards: steps in a row that ran the same action, and that fold, are
 * one card that says how many times. A reply that counted papers thirty-nine times ran
 * thirty-nine cards down the page. opencode folds a run of reads into one row the same way
 * (its context tool group). A step with an undo, an error or a question is always its own card.
 */
function runsOf(steps: StepItem[]) {
  const runs: StepItem[][] = [];
  for (const step of steps) {
    const run = runs.at(-1);
    if (run && folds(step) && folds(run[0]) && run[0].action === step.action && run[0].variant === step.variant) run.push(step);
    else runs.push([step]);
  }
  return runs;
}

/**
 * How much of their start a run's lines share, to a whole word: a run of searches is one
 * query with a different last clause each time, and a line cut at its end would show the
 * same words as the next. Nothing when the lines share little, or one of them is all of it.
 */
function sharedStart(lines: string[]) {
  const [first, ...rest] = lines;
  let end = first.length;
  for (const line of rest) {
    let at = 0;
    while (at < end && line[at] === first[at]) at += 1;
    end = at;
  }
  const from = first.lastIndexOf(" ", end - 1) + 1;
  return from >= 24 && lines.every((line) => line.length > from) ? from : 0;
}

function RunMap({ threadId, steps, earlier }: { threadId: Id<"assistantThreads">; steps: StepItem[]; /** Loads the steps before these, when the reply ran more. */ earlier: (() => void) | "loading" | null }) {
  const t = useTranslations("assistant");
  const reduceMotion = useReducedMotion();
  const undo = useMutation(api.assistant.undo.run);
  const toast = useAppToast();
  const stepTitle = useStepTitle();
  // The folded runs the person opened, each by its first step.
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const runs = runsOf(steps);
  const heights = runs.map((run) => CARD + (run.length > 1 && opened.has(run[0].id) ? run.length * LINE + LINES_END : 0));
  const tops = heights.map((_, i) => heights.slice(0, i).reduce((top, above) => top + above + GAP, ORIGIN));
  const height = runs.length ? tops.at(-1)! + heights.at(-1)! : 0;
  const y = (i: number) => tops[i] + CARD / 2;
  const curve = (i: number) => `M 12 22 C 12 ${22 + (y(i) - 22) * 0.75}, 16 ${y(i)}, ${GUTTER} ${y(i)}`;
  // One pace for the map's frame, its cards and its curves, so a run that opens never runs over what's under it.
  const slide = reduceMotion ? { duration: 0 } : { duration: 0.45, ease: EASE };
  return (
    <motion.div
      className="relative grid grid-cols-[36px_1fr]"
      initial={false}
      animate={{ height: Math.max(0, height) }}
      transition={slide}
    >
      <span className="absolute left-0.5 top-0 flex size-5 items-center justify-center rounded-md bg-primary/10">
        <OrbitMark size={14} />
      </span>
      {earlier ? (
        // Beside the tile, in the room the curves start from, so the cards stay where they are.
        <button
          type="button"
          disabled={earlier === "loading"}
          onClick={earlier === "loading" ? undefined : earlier}
          className="absolute left-9 top-0 z-10 flex h-5 items-center rounded-full px-2 text-xs font-medium text-foreground/80 hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          {t("steps.earlier")}
        </button>
      ) : null}
      <svg className="overflow-visible" width={GUTTER} height={height} aria-hidden>
        {runs.map(([step], i) => (
          <motion.path
            key={step.id}
            fill="none"
            stroke={KIND[viewOf(step.action, step.variant).kind].tint}
            strokeWidth={2}
            strokeLinecap="round"
            initial={reduceMotion ? false : { pathLength: 0, d: curve(i) }}
            animate={{ pathLength: 1, d: curve(i), opacity: step.undone || step.status === "failed" || step.status === "declined" ? 0.25 : 1 }}
            transition={{ duration: 0.5, ease: EASE, d: slide }}
          />
        ))}
      </svg>
      <div className="relative">
        <AnimatePresence initial={false}>
          {runs.map((run, i) => {
            // A folded run shows the step it's on, or the last it ran.
            const step = run.find((one) => one.status === "running") ?? run.at(-1)!;
            const { kind, words } = viewOf(step.action, step.variant);
            const working = step.status === "running";
            const faded = step.undone || step.status === "failed" || step.status === "declined";
            const state = step.status === "asking" ? t("steps.waiting") : step.status === "allowed" ? t("steps.allowed") : step.status === "declined" ? t("steps.declined") : null;
            const title = stepTitle(words, step);
            const folded = run.length > 1;
            const open = folded && opened.has(run[0].id);
            const lines = run.map((one) => one.subject ?? t(`steps.${words}.where`));
            const shared = folded ? sharedStart(lines) : 0;
            return (
              <motion.div
                key={run[0].id}
                className="absolute inset-x-0"
                initial={{ opacity: 0, x: -8, scale: 0.97, top: tops[i] }}
                animate={{ opacity: faded ? 0.55 : 1, x: 0, scale: 1, top: tops[i] }}
                transition={{ duration: 0.4, ease: EASE, delay: reduceMotion ? 0 : 0.15, top: slide }}
              >
                <motion.div className="overflow-hidden rounded-2xl border border-border/60 bg-muted/40" initial={false} animate={{ height: heights[i] }} transition={slide}>
                  {/* The card's own row: as tall as a card inside its border. */}
                  <div className="flex items-center gap-3 px-3" style={{ height: CARD - 2 }}>
                    <KindTile kind={kind} working={working} />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className={cn("truncate text-sm font-semibold", step.undone && "line-through decoration-muted-foreground/60")}>{working ? <WorkingText>{title}</WorkingText> : title}</p>
                      <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-muted-foreground">
                        {/* Why it failed. Under a bulk change that was undone, what couldn't be put back, if anything. */}
                        {(step.status === "failed" && !step.undone) || (step.undone && step.error) ? (
                          <span className="truncate">{step.error ?? t("steps.interrupted")}</span>
                        ) : state ? (
                          <>
                            <Fact>{state}</Fact>
                            {step.subject ? <span className="truncate">{step.subject}</span> : null}
                          </>
                        ) : folded ? (
                          <>
                            <Fact value={run.length}>{t("steps.times", { count: run.length })}</Fact>
                            <span className="truncate">{step.subject ?? t(`steps.${words}.where`)}</span>
                          </>
                        ) : (
                          <>
                            {/* A bulk change's title says how many it made. */}
                            {step.batch === undefined && step.count !== undefined ? <Fact value={step.count}>{t("steps.found")}</Fact> : null}
                            {step.subject ? <span className="truncate">{step.subject}</span> : null}
                            {(step.batch !== undefined || step.count === undefined) && !step.subject ? <span className="truncate">{t(`steps.${words}.where`)}</span> : null}
                          </>
                        )}
                      </div>
                    </div>
                    {/* A folded run opens into its steps. A bulk change that ended partway made some of its changes: those can still be undone. */}
                    {folded ? (
                      <TooltipHint label={t(open ? "steps.fold" : "steps.unfold")}>
                        <button
                          type="button"
                          aria-label={t(open ? "steps.fold" : "steps.unfold")}
                          aria-expanded={open}
                          onClick={() => setOpened((all) => new Set(open ? [...all].filter((id) => id !== run[0].id) : [...all, run[0].id]))}
                          className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
                        </button>
                      </TooltipHint>
                    ) : step.status === "failed" && !step.canUndo ? (
                      <CircleAlert className="size-4 shrink-0 text-destructive" aria-label={t("steps.failed")} />
                    ) : step.canUndo ? (
                      <button
                        type="button"
                        onClick={() => undo({ threadId, stepId: step.id as Id<"assistantSteps"> }).catch((error) => toast.error(t("steps.undoFailed"), getErrorMessage(error, "")))}
                        className="flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Undo2 className="size-3" /> {t("steps.undo")}
                      </button>
                    ) : step.status === "done" && !step.undone ? (
                      <Check className="size-4 shrink-0 text-success" aria-label={t("steps.done")} />
                    ) : null}
                  </div>
                  {folded ? (
                    // Each step of the run as a line, under the card's text: what it was about, and how many it found.
                    <ol inert={!open} className="pl-[60px] pr-3 text-xs text-muted-foreground">
                      {run.map((one, at) => (
                        <li key={one.id} className="flex items-center gap-2" style={{ height: LINE }}>
                          <span className="min-w-0 flex-1 truncate">{shared ? `… ${lines[at].slice(shared)}` : lines[at]}</span>
                          {one.count !== undefined ? (
                            <span className="shrink-0 tabular-nums">
                              <span className="font-semibold text-foreground/90">{one.count}</span> {t("steps.found")}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </motion.div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
