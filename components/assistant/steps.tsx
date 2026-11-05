"use client";

// What the assistant did in a reply, drawn like the AI settings routing map: a tile at the
// top, a tinted curve out to each step's card, one card per action it ran. An action it
// asks the person about first shows under the map as the mock's approval card.

import { createContext, useContext, useState, type ReactNode } from "react";
import Link from "@/components/workspace-link";
import { SearchHoverCard } from "@/components/search-tooltip-content";
import { FilterChips } from "@/components/ui/filter-display";
import type { FilterParams } from "@/lib/filters";
import { differences } from "@/lib/assistant/run-filters";
import { readSharedOql } from "@/lib/search-params";
import { paramsToSearchResult } from "@/lib/search-params/converters";
import { parseSearchParamsFromUrl } from "@/lib/search-params/parsers";
import { useFormatter, useTranslations } from "next-intl";
import { useAction, useMutation, usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, AuthorsIcon, Check, ChevronDown, CircleAlert, Coins, Compass, FileSearch, Globe, Plus, Undo2, X, type AppIcon } from "@/components/icons";
import { RECORD_KINDS } from "@/components/record-kinds";
import { ZoteroIcon } from "@/components/icons/zotero-icon";
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
import { askedGroups, runsOf, shownSteps, whyAsked } from "@/lib/assistant/step-cards";
import { OrbitMark } from "./orbit-mark";
import { CARD_SPRING, DockedJobs, JOB_STARTS, JobCard } from "./job-cards";
import { WorkingText } from "./parts";
import { FadeRow } from "@/components/ui/fade-row";
import { inWorkspace, useWorkspace } from "@/lib/workspaces/url";
import { useSpendable } from "@/components/workspaces/credit-check";
import { useCurrentWorkspace, WorkspaceTile } from "@/components/workspaces/parts";

type Item = FunctionReturnType<typeof api.assistant.replies.messages>["page"][number];
export type StepItem = Extract<Item, { role: "step" }>;

/** Each kind's icon, the same as everywhere in the app, and its colour, which only the assistant uses (components/record-kinds.ts). `other` is an action on no one record. */
export const KIND = {
  web: { icon: Globe, tint: "var(--kind-web)" },
  file: { icon: FileSearch, tint: "var(--kind-file)" },
  search: RECORD_KINDS.search,
  paper: RECORD_KINDS.paper,
  collection: RECORD_KINDS.collection,
  screening: RECORD_KINDS.screening,
  extraction: RECORD_KINDS.extraction,
  chat: RECORD_KINDS.chat,
  library: RECORD_KINDS.library,
  topic: RECORD_KINDS.topic,
  zotero: { icon: ZoteroIcon, tint: "var(--kind-zotero)" },
  author: { icon: AuthorsIcon, tint: "var(--kind-author)" },
  other: { icon: Compass, tint: "var(--muted-foreground)" },
} satisfies Record<Kind, { icon: AppIcon; tint: string }>;

const CARD = 56;
const GAP = 8;
const GUTTER = 36;
/** Room at the top for the tile the curves start from. */
const ORIGIN = 28;
/** One step of a folded run, as a line under its card. */
const LINE = 28;
/** Room under a folded run's lines. */
const LINES_END = 8;

/** A search as its link carries it: its query, with an OQL one in the fragment, and its filters. */
function searchOf(href: string) {
  const url = new URL(href, "https://openscholar.invalid");
  const params = parseSearchParamsFromUrl(url.searchParams);
  const oql = readSharedOql(url.hash);
  return paramsToSearchResult(oql ? { ...params, q: oql } : params);
}

/**
 * What a step was about, as its card shows it. A query it looked up opens that query's
 * results in this tab, as a new search, and the panel stays up with its chat. Hovered, it
 * shows the search's card out to the left, over the page, as the sidebar's history does.
 */
function Subject({ text, step, chips, unqueried = false, className = "truncate" }: { text: string; step: Pick<StepItem, "id" | "href" | "opens" | "count" | "at">; /** The settings that tell this search from the others on its card, as chips after its query. */ chips?: FilterParams; /** `text` stands in for a query the search didn't have: written as the search history writes it, and never cut to make room for its chips. */ unqueried?: boolean; className?: string }) {
  const underlined = "underline decoration-muted-foreground/40 underline-offset-2 transition-colors hover:text-foreground hover:decoration-foreground";
  // The one record it acted on, such as the extraction it paused, opens on its page.
  if (step.opens && !step.href)
    return (
      <Link href={step.opens} className={cn(className, underlined)}>
        {text}
      </Link>
    );
  if (!step.href) return <span className={className}>{text}</span>;
  const search = searchOf(step.href);
  const at = new Date(step.at).toISOString();
  return (
    <SearchHoverCard side="left" delay={300} id={step.id} query={search.query} count={step.count} filters={search} createdAt={at} updatedAt={at}>
      {chips ? (
        <Link href={step.href} className={cn(className, "group flex items-center gap-1.5")}>
          {text ? <span className={unqueried ? "shrink-0 italic" : cn("min-w-0 truncate", underlined)}>{text}</span> : null}
          {/* One row, faded where it runs on: the search's card shows them all. Beside a query it takes at most part of the line. */}
          <FadeRow className={cn("transition-colors group-hover:[&_[data-slot=badge]]:text-foreground", unqueried ? "max-w-full" : "shrink-0", !unqueried && (text ? "max-w-[60%]" : "max-w-full"))}>
            <FilterChips filters={chips} size="compact" singleLine valuesOnly />
          </FadeRow>
        </Link>
      ) : (
        <Link href={step.href} className={cn(className, underlined)}>
          {text}
        </Link>
      )}
    </SearchHoverCard>
  );
}

/** A search that ran on filters alone, with no query: it says so, and shows those filters. */
function Unqueried({ step, chips, className }: { step: StepItem & { href: string }; /** Its filters the others on its card don't share; all of its own when it's alone. */ chips?: FilterParams; className?: string }) {
  const tc = useTranslations("common");
  return <Subject unqueried text={tc("noQuery")} chips={chips ?? searchOf(step.href)} step={step} className={className} />;
}

/** Whether a step is a search that ran with no query. */
const unqueried = (step: StepItem): step is StepItem & { href: string } => !step.subject && step.href !== undefined;

/** A tinted icon square; the tile of the model cards, one size down. */
export function KindTile({ kind, size = "md", working }: { kind: Kind; size?: "sm" | "md"; working?: boolean }) {
  const { icon: Icon, tint } = KIND[kind];
  const reduceMotion = useReducedMotion();
  return (
    <motion.span
      animate={working && !reduceMotion ? { scale: [1, 1.08, 1] } : { scale: 1 }}
      transition={working ? { duration: 1.1, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
      className={cn("flex shrink-0 items-center justify-center", size === "sm" ? "size-5 rounded-md" : "size-9 rounded-xl")}
      style={{ backgroundColor: `color-mix(in oklab, ${tint} 18%, transparent)`, color: tint }}
    >
      <Icon className={size === "sm" ? "size-3" : "size-4"} />
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
  const workspaceId = useWorkspace();
  // An exchange that ran more than the page holds has the ones before them a page away. Reading them here also
  // keeps the ones the page lets go of as the reply runs on, so no card leaves the map: the read starts at half
  // a page, well before the page lets any go. It runs from the reply's first exchange through its last, which
  // only changes when a reply still running carries on in a new one.
  const ran = new Map<number, number>();
  for (const step of newest) ran.set(step.order, (ran.get(step.order) ?? 0) + 1);
  const cut = [...ran.values()].some((count) => count >= STEPS_SHOWN / 2);
  const range = { order: Math.min(...ran.keys()), through: Math.max(...ran.keys()) };
  const { results, status, loadMore } = usePaginatedQuery(api.assistant.replies.steps, inWorkspace(workspaceId, cut ? { threadId, ...range } : "skip"), { initialNumItems: STEPS_SHOWN });
  // In the order they ran, whichever page brought them. The page's copy of a step is the one kept: it says what a step that waits for the person would do.
  const all = [...new Map([...results.toReversed(), ...newest].map((step) => [step.id, step])).values()].sort((a, b) => a.order - b.order || a.at - b.at);
  const asked = all.filter((step) => step.canAnswer);
  const steps = shownSteps(all.filter((step) => !step.canAnswer));
  const { docked, flying } = useContext(DockedJobs);
  const reduceMotion = useReducedMotion();
  return (
    <div className="space-y-3">
      {steps.length ? <RunMap threadId={threadId} steps={steps} earlier={status === "CanLoadMore" ? () => loadMore(STEPS_SHOWN) : status === "LoadingMore" ? "loading" : null} /> : null}
      <AnimatePresence initial={false}>
        {askedGroups(asked).map((group) => (
          <ApprovalCard key={group[0].id} threadId={threadId} steps={group} />
        ))}
      </AnimatePresence>
      {/* Each job the reply started, under its map, once it has ended: while it runs, its card is docked over the message box. As it
          ends, its place opens here and the card flies in from the dock (JobFlight), showing here once it lands; the ones already here
          when the chat shows are in place. Each place holds its own gap, so a first card opens all of its room smoothly. */}
      <div className="!mt-0">
        <AnimatePresence initial={false}>
          {steps
            .filter((step) => JOB_STARTS.has(step.action) && step.status === "done" && !docked.has(step.id))
            .map((step) => (
              <motion.div key={`job:${step.id}`} data-job-slot={step.id} initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} transition={reduceMotion ? { duration: 0 } : CARD_SPRING} className="overflow-hidden">
                <div className={cn("pt-3", flying.has(step.id) && "invisible")}>
                  <JobCard threadId={threadId} stepId={step.id} />
                </div>
              </motion.div>
            ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Names of a call's arguments the card says in the person's language; any other shows as the action names it. */
const NAMED = ["query", "file", "range", "thread", "collection", "user", "organization", "role", "name", "title", "model", "search", "screening", "papers", "first", "last", "question", "saveTo", "prune", "rating", "change", "usePdfs", "job", "email", "clerkUser", "sectionKey", "path", "zotero", "group"] as const;

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
  const formOf = (step: Pick<StepItem, "status">) => (step.status === "asking" || step.status === "allowed" || step.status === "declined" ? "ask" : step.status === "running" || step.status === "failed" ? "doing" : "did");
  /** Whether the words have a title for many calls in this form that says how many: "Saved 5 papers", not "Removed all your searches". Without one, a card for many says how many beside its title. */
  const saysMany = (words: string, step: Pick<StepItem, "status">) => {
    const many = `steps.${words}.${formOf(step)}Many` as "steps.other.askMany";
    return t.has(many) && String(t.raw(many)).includes("{count");
  };
  /** `calls`: how many calls one card stands for, folded or asked together. */
  const title = (words: string, step: Pick<StepItem, "status" | "batch" | "count">, calls = 1): string => {
    const form = formOf(step);
    if (calls > 1) return saysMany(words, step) ? t(`steps.${words}.${form}Many` as "steps.other.askMany", { count: calls }) : title(words, { status: step.status });
    const many = step.batch === undefined ? "" : "Many";
    const own = `steps.${words}.${form}${many}` as "steps.other.askMany";
    return t(t.has(own) ? own : (`steps.other.${form}${many}` as "steps.other.askMany"), { count: (form === "did" ? step.count : undefined) ?? step.batch ?? 1 });
  };
  return { title, saysMany };
}

/**
 * Asks before a change that can't be undone or that shows outside the account: what it
 * would do, with the records it names, then Allow once or Not now. One that spends credits
 * (#328) asks with the most it holds against the person's balance, and can be allowed for
 * the rest of the chat. A bulk change asks once for all of it, with the first of the records
 * it's made to and how many more there are. Calls of one action asked about together are one
 * card (`askedGroups`): what they're all given alike, then each of them, with one answer and
 * what they cost together. The mock's approval card.
 */
function ApprovalCard({ threadId, steps }: { threadId: Id<"assistantThreads">; /** Calls of one action, asked about together. */ steps: StepItem[] }) {
  const t = useTranslations("assistant");
  const answer = useMutation(api.assistant.replies.answer);
  const toast = useAppToast();
  // Pressed once: the buttons rest until the chat shows the answer, or says it couldn't be sent.
  const [sent, setSent] = useState(false);
  const [step] = steps;
  const { kind, words } = viewOf(step.action, step.variant);
  const addCredits = useContext(AddCredits);
  const common = useTranslations("common");
  const { title, saysMany } = useStepTitle();
  const heading = title(words, step, steps.length);
  /** A value as the card says it: a setting that is on or off as yes or no, not as the action writes it. A name that happens to read "true" stays as typed. */
  const said = ({ name, value }: { name: string; value: string }) => (SWITCHES.has(name) && (value === "true" || value === "false") ? common(value === "true" ? "yes" : "no") : value);
  // Of calls asked together, what all are given alike is said once, and each of them as what it alone is given, as a bulk change says its changes.
  const alike = (detail: { name: string; value: string }) => steps.length > 1 && steps.every((one) => one.details?.some((other) => other.name === detail.name && other.value === detail.value));
  const details = (step.details ?? []).filter((detail) => steps.length === 1 || alike(detail));
  // A call given just what the others are is told apart by what it's about.
  const each = steps.length > 1 ? steps.map((one) => { const own = (one.details ?? []).filter((detail) => !alike(detail)); return own.length ? own : [{ name: "title", value: one.subject ?? "" }]; }) : (step.each ?? []);
  const held = steps.filter((one) => one.credits !== undefined);
  const credits = held.length ? held.reduce((sum, one) => sum + one.credits!, 0) : undefined;
  /** An argument's name in the person's language, where the card has one; any other shows as the action names it. */
  const named = (name: string) => ((NAMED as readonly string[]).includes(name) ? t(`asks.names.${name as (typeof NAMED)[number]}`) : name);
  const say = (allow: boolean, always?: boolean) => {
    setSent(true);
    answer({ threadId, stepIds: steps.map((one) => one.id as Id<"assistantSteps">), allow, ...(always ? { always } : {}) }).catch((error) => {
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
          <p className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <span className="min-w-0">{heading}</span>
            {/* Calls asked together whose words can't say how many: how many, beside them. */}
            {steps.length > 1 && !saysMany(words, step) ? <Fact value={steps.length}>{t("steps.times", { count: steps.length })}</Fact> : null}
          </p>
          <ul className="mt-1.5 space-y-1 text-sm text-muted-foreground empty:hidden">
            {details.map((detail, i) => (
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
            className="-me-1 -mt-1 flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <X className="size-4" />
          </button>
        </TooltipHint>
      </div>
      {credits === undefined ? (
        <>
          <p className="px-4 pb-4 text-xs text-muted-foreground">{t(`asks.${whyAsked(step)}`)}</p>
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
        <Spending credits={credits} typical={TYPICAL_COST.has(step.action)} sent={sent} onAllow={() => say(true)} onAlways={() => say(true, true)} onDecline={() => say(false)} onAddCredits={() => addCredits({ kind, title: heading, credits })} />
      )}
    </motion.div>
  );
}

/** Actions whose cost is known only once they run, asked about with what one typically costs: a paper's PDF, read whole, is as long as it is. */
const TYPICAL_COST = new Set(["research/papers:readPdf"]);

/** What a balance has and what's left once a call takes from it, or how far short it is. Both labels hold their place, so the row never reflows when the balance changes; nothing is said until it's read. */
function Drawn({ have, take, known, className }: { have: number; take: number; known: boolean; className?: string }) {
  const t = useTranslations("assistant.asks");
  const short = known && take > have;
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5 tabular-nums transition-opacity duration-200", !known && "opacity-0", className)} aria-hidden={!known}>
      <AnimatedNumber value={have} />
      <ArrowRight className="size-3" />
      <span className="grid font-medium [&>*]:col-start-1 [&>*]:row-start-1 [&>*]:text-end">
        <motion.span initial={false} animate={{ opacity: short ? 1 : 0 }} aria-hidden={!short} className="text-amber-600 dark:text-amber-400">
          {t("short", { credits: Math.max(0, take - have) })}
        </motion.span>
        <motion.span initial={false} animate={{ opacity: short ? 0 : 1 }} aria-hidden={short} className="text-foreground">
          {t.rich("left", { n: () => <AnimatedNumber value={Math.max(0, have - take)} /> })}
        </motion.span>
      </span>
    </span>
  );
}

/** The bar is the balance; the filled part is what the call takes from it. */
function Bar({ have, take, known }: { have: number; take: number; known: boolean }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
      <motion.span
        className={cn("block h-full rounded-full", known && take > have ? "bg-amber-400" : "bg-primary")}
        initial={false}
        animate={{ width: `${(known ? Math.min(1, take / Math.max(have, 1)) : 0) * 100}%` }}
        transition={{ type: "spring", stiffness: 170, damping: 26 }}
      />
    </div>
  );
}

/** One thing an organization's call draws on, named: its credits, or the person's cap this month. */
function Draw({ label, have, take, known }: { label: string; have: number; take: number; known: boolean }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{label}</span>
        <Drawn have={have} take={take} known={known} className="shrink-0" />
      </div>
      <Bar have={have} take={take} known={known} />
    </div>
  );
}

/**
 * The part of an approval card for a call that spends credits: the most it holds against the
 * person's balance, or for one whose cost can't be bounded, what it typically costs (`typical`),
 * then Allow once or Always allow in this chat. When the balance can't cover it, the buttons
 * turn into a top-up, and turn back once the credits land.
 */
function Spending({ credits, typical, sent, onAllow, onAlways, onDecline, onAddCredits }: { credits: number; typical: boolean; sent: boolean; onAllow: () => void; onAlways: () => void; onDecline: () => void; onAddCredits: () => void }) {
  const t = useTranslations("assistant.asks");
  const spend = useSpendable();
  // In an organization, its credits pay, within the cap an admin set on the person (#651, #652): each is a bar of its own.
  const workspace = useCurrentWorkspace();
  const organization = workspace?.kind === "organization" ? workspace : undefined;
  // Until the balance is read, nothing is said about it, and the row keeps its room.
  const known = spend.loaded;
  const balance = Math.floor(spend.pool);
  const capLeft = spend.left === undefined ? undefined : Math.floor(spend.left);
  const short = known && credits > balance;
  // The organization has the credits and the person's cap doesn't: an admin raises it, and adding credits changes nothing.
  const overCap = known && !short && capLeft !== undefined && credits > capLeft;
  return (
    <>
      {organization ? (
        <div className="space-y-3 px-4 pb-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Coins className="size-3.5 text-primary" />
            <span className="font-medium text-foreground">{t(typical ? "about" : "upTo", { credits })}</span>
            <span className="ms-auto flex min-w-0 items-center gap-1.5">
              <WorkspaceTile workspace={organization} size="xs" />
              <span className="min-w-0 truncate">{organization.name}</span>
            </span>
          </div>
          <Draw label={t("creditsOf", { name: organization.name })} have={balance} take={credits} known={known} />
          {capLeft === undefined ? null : <Draw label={t("yourCap")} have={capLeft} take={credits} known />}
        </div>
      ) : (
        <div className="space-y-2 px-4 pb-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Coins className="size-3.5 text-primary" />
            <span className="font-medium text-foreground">{t(typical ? "about" : "upTo", { credits })}</span>
            <Drawn have={balance} take={credits} known={known} className="ms-auto" />
          </div>
          <Bar have={balance} take={credits} known={known} />
        </div>
      )}
      {/* The two sets of buttons share one cell and cross-fade, so the card keeps its height. */}
      <div className="grid border-t border-primary/15 p-3 [&>*]:col-start-1 [&>*]:row-start-1">
        {/* Two equal buttons side by side, with little padding so the English pair fits the panel. In a language where one doesn't fit its half, each takes a line of its own: a yes is never cut short.
            Neither can be pressed until the balance is read, since a yes the balance can't cover is refused. */}
        <motion.div initial={false} animate={{ opacity: short || overCap ? 0 : 1, scale: short || overCap ? 0.98 : 1 }} transition={{ duration: 0.25, ease: EASE }} inert={short || overCap} className="flex flex-wrap gap-2">
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
        {/* Over the person's cap: an admin goes to raise it where caps are set; a member is told to ask one. */}
        {capLeft === undefined ? null : (
          <motion.div initial={false} animate={{ opacity: overCap ? 1 : 0, scale: overCap ? 1 : 0.98 }} transition={{ duration: 0.25, ease: EASE }} inert={!overCap} className="grid grid-cols-[1fr_auto] gap-2">
            {organization?.role === "admin" ? (
              <Button asChild className="h-9 gap-1.5">
                <Link href="/settings/billing">
                  {t("raiseCap")} <ArrowRight className="size-4" />
                </Link>
              </Button>
            ) : (
              <p className="flex min-h-9 items-center justify-center rounded-lg bg-muted/60 px-3 text-center text-xs text-muted-foreground">{t("overCap", { credits: Math.max(0, credits - capLeft) })}</p>
            )}
            <Button className="h-9 px-4" variant="secondary" disabled={sent} onClick={onDecline}>
              {t("notNow")}
            </Button>
          </motion.div>
        )}
      </div>
    </>
  );
}

function RunMap({ threadId, steps, earlier }: { threadId: Id<"assistantThreads">; steps: StepItem[]; /** Loads the steps before these, when the reply ran more. */ earlier: (() => void) | "loading" | null }) {
  const t = useTranslations("assistant");
  const tc = useTranslations("common");
  const format = useFormatter();
  // A count as the search history writes one: compact past a thousand, so a broad query's 329.5M fits its line.
  const counted = (count: number) => format.number(count, count >= 1000 ? { notation: "compact", maximumFractionDigits: 1 } : undefined);
  const reduceMotion = useReducedMotion();
  const undo = useMutation(api.assistant.undo.run);
  const undoOutside = useAction(api.assistant.undo.runAction);
  const toast = useAppToast();
  const { title: stepTitle, saysMany } = useStepTitle();
  // The steps being undone, whose Undo rests until the chat shows them undone.
  const [undoing, setUndoing] = useState<ReadonlySet<string>>(new Set());
  /** Undoes these steps together, the last made first (convex/assistant/undo.ts): a card's Undo does its whole run, a line's its own step. One that can't be undone leaves them all as they are. */
  const undoSteps = async (some: StepItem[]) => {
    const undoable = some.filter((one) => one.canUndo);
    const ids = undoable.map((one) => one.id);
    setUndoing((all) => new Set([...all, ...ids]));
    try {
      const inside = undoable.filter((one) => !one.undoAction).map((one) => one.id as Id<"assistantSteps">);
      if (inside.length) await undo({ threadId, stepIds: inside });
      // Changes outside the account are put back on their own, the last made first (convex/assistant/undo.ts `runAction`).
      const outside = undoable.filter((one) => one.undoAction).map((one) => one.id as Id<"assistantSteps">);
      if (outside.length) await undoOutside({ threadId, stepIds: outside });
    } catch (error) {
      toast.error(t("steps.undoFailed"), getErrorMessage(error, ""));
    } finally {
      setUndoing((all) => new Set([...all].filter((id) => !ids.includes(id))));
    }
  };
  // The folded runs the person opened, each by a step of it: by its first when it was opened, which stays in the run when earlier steps load in front of it.
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  /** Each step of a folded run as its line: what it was about, or where its card's action looks. */
  const linesOf = (run: StepItem[]) => run.map((one) => one.subject ?? (unqueried(one) ? tc("noQuery") : t(`steps.${viewOf(one.action, one.variant).words}.where`)));
  /** What tells a folded run of searches apart: each one's settings the others don't share. */
  const toldOf = (run: StepItem[]) => {
    const searches = run.length > 1 ? run.map((one) => (one.href ? searchOf(one.href) : null)) : [];
    return searches.length && searches.every((search) => search !== null) ? differences(searches as NonNullable<(typeof searches)[number]>[]) : null;
  };
  // A run opens into its steps only when they say something its card doesn't: what each was about, why each
  // failed, or the filters its searches differ by; or when more than one can be undone, each by its own line.
  // Six lines that all read "Extraction" tell the person nothing more.
  const opensOf = (run: StepItem[]) =>
    run.length > 1 && (new Set(linesOf(run)).size > 1 || new Set(run.map((one) => one.error)).size > 1 || run.filter((one) => one.canUndo).length > 1 || (toldOf(run)?.filters.some((filters) => filters !== undefined) ?? false));
  // One that stops opening, when the step that told it apart fails and leaves it, closes with it.
  const isOpen = (run: StepItem[]) => opensOf(run) && run.some((one) => opened.has(one.id));
  const runs = runsOf(steps);
  const heights = runs.map((run) => CARD + (isOpen(run) ? run.length * LINE + LINES_END : 0));
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
      <span className="absolute start-0.5 top-0 flex size-5 items-center justify-center rounded-md bg-primary/10">
        <OrbitMark size={14} />
      </span>
      {earlier ? (
        // Beside the tile, in the room the curves start from, so the cards stay where they are.
        <button
          type="button"
          disabled={earlier === "loading"}
          onClick={earlier === "loading" ? undefined : earlier}
          className="absolute start-9 top-0 z-10 flex h-5 items-center rounded-full px-2 text-xs font-medium text-foreground/80 hover:bg-muted hover:text-foreground disabled:opacity-50"
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
            // A run is faded and struck through once all of it is.
            const faded = run.every((one) => one.undone || one.status === "failed" || one.status === "declined");
            const state = step.status === "asking" ? t("steps.waiting") : step.status === "allowed" ? t("steps.allowed") : step.status === "declined" ? t("steps.declined") : null;
            const title = stepTitle(words, step, run.length);
            const folded = run.length > 1;
            const open = isOpen(run);
            const lines = linesOf(run);
            const told = toldOf(run);
            const opens = opensOf(run);
            const undoable = run.filter((one) => one.canUndo);
            const undoButton = undoable.length ? (
              <button
                type="button"
                disabled={undoable.some((one) => undoing.has(one.id))}
                onClick={() => undoSteps(undoable)}
                className="flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <Undo2 className="size-3" /> {t("steps.undo")}
              </button>
            ) : null;
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
                      <p className={cn("truncate text-sm font-semibold", run.every((one) => one.undone) && "line-through decoration-muted-foreground/60")}>{working ? <WorkingText>{title}</WorkingText> : title}</p>
                      <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-muted-foreground">
                        {/* A folded run: how many, where its title doesn't say, then what the last was about, or why it failed. A step alone: why it failed,
                            or under a bulk change that was undone, what couldn't be put back, if anything. */}
                        {folded ? (
                          <>
                            {/* Turned down, or allowed and waiting to run, the run says so first. */}
                            {state ? <Fact>{state}</Fact> : null}
                            {saysMany(words, step) ? null : <Fact value={run.length}>{t("steps.times", { count: run.length })}</Fact>}
                            {step.status === "failed" ? (
                              <span className="truncate">{step.error ?? t("steps.interrupted")}</span>
                            ) : step.subject ? (
                              <Subject text={step.subject} step={step} className={cn("truncate", step.undone && "line-through")} />
                            ) : unqueried(step) ? (
                              <Unqueried step={step} />
                            ) : (
                              <span className="truncate">{t(`steps.${words}.where`)}</span>
                            )}
                          </>
                        ) : (step.status === "failed" && !step.undone) || (step.undone && step.error) ? (
                          <span className="truncate">{step.error ?? t("steps.interrupted")}</span>
                        ) : state ? (
                          <>
                            <Fact>{state}</Fact>
                            {step.subject ? <Subject text={step.subject} step={step} /> : null}
                          </>
                        ) : (
                          <>
                            {/* A bulk change's title says how many it made. */}
                            {step.batch === undefined && step.count !== undefined ? <Fact value={counted(step.count)}>{t("steps.found")}</Fact> : null}
                            {step.subject ? <Subject text={step.subject} step={step} /> : unqueried(step) ? <Unqueried step={step} /> : null}
                            {(step.batch !== undefined || step.count === undefined) && !step.subject && !unqueried(step) ? <span className="truncate">{t(`steps.${words}.where`)}</span> : null}
                          </>
                        )}
                      </div>
                    </div>
                    {/* A folded run opens into its steps, and undoes all of them that can be. A bulk change that ended partway made some of its changes: those can still be undone. */}
                    {opens ? (
                      <div className="flex shrink-0 items-center gap-1">
                      {undoButton}
                      <TooltipHint label={t(open ? "steps.fold" : "steps.unfold")}>
                        <button
                          type="button"
                          aria-label={t(open ? "steps.fold" : "steps.unfold")}
                          aria-expanded={open}
                          onClick={() => setOpened((all) => (open ? new Set([...all].filter((id) => !run.some((one) => one.id === id))) : new Set([...all, run[0].id])))}
                          className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
                        </button>
                      </TooltipHint>
                      </div>
                    ) : step.status === "failed" && !step.canUndo ? (
                      <CircleAlert className="size-4 shrink-0 text-destructive" aria-label={t("steps.failed")} />
                    ) : undoButton ? (
                      undoButton
                    ) : step.status === "done" && !step.undone ? (
                      <Check className="size-4 shrink-0 text-success" aria-label={t("steps.done")} />
                    ) : null}
                  </div>
                  {opens ? (
                    // Each step of the run as a line, under the card's text: what it was about, how many it found, why it failed, and its own Undo.
                    <ol inert={!open} className="ps-[60px] pe-3 text-xs text-muted-foreground">
                      {run.map((one, at) => (
                        <li key={one.id} className="flex items-center gap-2" style={{ height: LINE }}>
                          {unqueried(one) ? (
                            <Unqueried step={one} chips={told ? (told.filters[at] ?? {}) : undefined} className="me-auto min-w-0 truncate" />
                          ) : (
                            <Subject text={told?.sameQuery && told.filters[at] ? "" : lines[at]} chips={told?.filters[at]} step={one} className={cn("me-auto min-w-0 truncate", one.undone && "line-through")} />
                          )}
                          {one.count !== undefined ? (
                            <span className="shrink-0 tabular-nums">
                              <span className="font-semibold text-foreground/90">{counted(one.count)}</span> {t("steps.found")}
                            </span>
                          ) : null}
                          {one.error ? (
                            <TooltipHint label={one.error} onlyWhenClipped>
                              <span className="min-w-0 max-w-[55%] truncate">{one.error}</span>
                            </TooltipHint>
                          ) : null}
                          {one.canUndo ? (
                            <TooltipHint label={t("steps.undo")}>
                              <button
                                type="button"
                                aria-label={t("steps.undo")}
                                disabled={undoing.has(one.id)}
                                onClick={() => undoSteps([one])}
                                className="-me-1 flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                              >
                                <Undo2 className="size-3" />
                              </button>
                            </TooltipHint>
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
