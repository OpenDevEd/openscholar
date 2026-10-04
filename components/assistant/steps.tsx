"use client";

// What the assistant did in a reply, drawn like the AI settings routing map: a tile at the
// top, a tinted curve out to each step's card, one card per action it ran. An action it
// asks the person about first shows under the map as the mock's approval card.

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, CircleAlert, Compass, FileText, FolderPlus, ListChecks, MessagesSquare, Search, TableProperties, Undo2, X, type AppIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { TooltipHint } from "@/components/ui/tooltip";
import { EASE } from "@/components/settings/model-map";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getErrorMessage, useAppToast } from "@/lib/toast/use-app-toast";
import { cn } from "@/lib/utils";
import { LogoMark } from "./logo-mark";
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
type Kind = keyof typeof KIND;

/** The words for a kind of step: `assistant.steps.<words>` in the messages. */
type Words = "searches" | "search" | "searchHistory" | "newSearch" | "changeSearch" | "restoreSearch" | "removeSearch" | "results" | "lookup" | "lookPapers" | "readPaper" | "credits" | "bookmarks" | "ratings" | "saved" | "save" | "rate" | "remove" | "restore" | "collect" | "collections" | "collection" | "newCollection" | "renameCollection" | "deleteCollection" | "shareChat" | "unshareChat" | "deleteChat" | "newChat" | "renameChat" | "chatModel" | "screening" | "answer" | "extractions" | "other";

/** Each action's kind of work and the words for it; one that isn't here shows as work in the account. */
const ACTIONS: Record<string, { kind: Kind; words: Words }> = {
  "research/records:listedSearches": { kind: "search", words: "searches" },
  "research/records:countSearches": { kind: "search", words: "searches" },
  "research/records:getSearch": { kind: "search", words: "search" },
  "research/records:searchHistory": { kind: "search", words: "searchHistory" },
  "research/searches:create": { kind: "search", words: "newSearch" },
  "research/searches:update": { kind: "search", words: "changeSearch" },
  "research/searches:restore": { kind: "search", words: "restoreSearch" },
  "research/searches:remove": { kind: "search", words: "removeSearch" },
  "research/searches:results": { kind: "search", words: "results" },
  "research/lookup:find": { kind: "search", words: "lookup" },
  "research/papers:search": { kind: "search", words: "lookPapers" },
  "research/papers:get": { kind: "paper", words: "readPaper" },
  "research/searches:deleteSearch": { kind: "search", words: "removeSearch" },
  "research/records:listedShortcuts": { kind: "search", words: "bookmarks" },
  "research/records:ratingsOf": { kind: "paper", words: "ratings" },
  "library/queries:savedPaper": { kind: "paper", words: "saved" },
  "library/queries:papers": { kind: "paper", words: "saved" },
  "library/queries:countPapers": { kind: "paper", words: "saved" },
  "library/papers:save": { kind: "paper", words: "save" },
  "billing/usage:balance": { kind: "other", words: "credits" },
  "billing/usage:spending": { kind: "other", words: "credits" },
  "billing/usage:listCharges": { kind: "other", words: "credits" },
  "screening/queries:listJobs": { kind: "screening", words: "screening" },
  "library/mutations:saveToLibrary": { kind: "paper", words: "save" },
  "library/mutations:setLibraryRating": { kind: "paper", words: "rate" },
  "library/mutations:removeFromLibrary": { kind: "paper", words: "remove" },
  "library/mutations:restoreLibraryItem": { kind: "paper", words: "restore" },
  "library/mutations:setPaperInCollection": { kind: "collection", words: "collect" },
  "library/collections:addToCollection": { kind: "collection", words: "collect" },
  "library/collections:removeFromCollection": { kind: "collection", words: "collect" },
  "library/collections:listCollections": { kind: "collection", words: "collections" },
  "library/collections:getCollection": { kind: "collection", words: "collection" },
  "library/collections:createCollection": { kind: "collection", words: "newCollection" },
  "library/collections:renameCollection": { kind: "collection", words: "renameCollection" },
  "library/collections:deleteCollection": { kind: "collection", words: "deleteCollection" },
  "assistant/sharing:grant": { kind: "chat", words: "shareChat" },
  "assistant/sharing:revoke": { kind: "chat", words: "unshareChat" },
  "assistant/threads:remove": { kind: "chat", words: "deleteChat" },
  "assistant/threads:create": { kind: "chat", words: "newChat" },
  "assistant/threads:rename": { kind: "chat", words: "renameChat" },
  "assistant/threads:setModel": { kind: "chat", words: "chatModel" },
  "screening/papers:answer": { kind: "screening", words: "answer" },
  "screening/papers:list": { kind: "screening", words: "screening" },
  "screening/papers:get": { kind: "screening", words: "screening" },
  "extraction/queries:listJobs": { kind: "extraction", words: "extractions" },
};
const viewOf = (action: string): { kind: Kind; words: Words } => ACTIONS[action] ?? { kind: "other", words: "other" };

const CARD = 56;
const GAP = 8;
const GUTTER = 36;
/** Room at the top for the tile the curves start from. */
const ORIGIN = 28;

/** A tinted icon square; the tile of the model cards, one size down. */
function KindTile({ kind, working }: { kind: Kind; working?: boolean }) {
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
 * grows by a card as a step starts, so nothing above it moves.
 */
export function Steps({ threadId, steps: all }: { threadId: Id<"assistantThreads">; steps: StepItem[] }) {
  const asked = all.filter((step) => step.canAnswer);
  const steps = all.filter((step) => !step.canAnswer);
  return (
    <div className="space-y-3">
      {steps.length ? <RunMap threadId={threadId} steps={steps} /> : null}
      <AnimatePresence initial={false}>
        {asked.map((step) => (
          <ApprovalCard key={step.id} threadId={threadId} step={step} />
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Names of a call's arguments the card says in the person's language; any other shows as the action names it. */
const NAMED = ["thread", "collection", "user", "organization", "role", "name", "title", "model"] as const;

/**
 * Asks before a change that can't be undone or that shows outside the account: what it
 * would do, with the records it names, then Allow once or Not now. The mock's approval
 * card, without the credits row, which comes with the actions that spend them (#328).
 */
function ApprovalCard({ threadId, step }: { threadId: Id<"assistantThreads">; step: StepItem }) {
  const t = useTranslations("assistant");
  const answer = useMutation(api.assistant.replies.answer);
  const toast = useAppToast();
  // Pressed once: the buttons rest until the chat shows the answer, or says it couldn't be sent.
  const [sent, setSent] = useState(false);
  const { kind, words } = viewOf(step.action);
  // Only the kinds of action that can ask have the words for it.
  const title = `steps.${words}.ask` as "steps.other.ask";
  const say = (allow: boolean) => {
    setSent(true);
    answer({ threadId, stepId: step.id as Id<"assistantSteps">, allow }).catch((error) => {
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
          <p className="text-sm font-semibold">{t.has(title) ? t(title) : t("steps.other.ask")}</p>
          <ul className="mt-1.5 space-y-1 text-sm text-muted-foreground">
            {(step.details ?? []).map((detail, i) => (
              <li key={i} className="flex gap-2">
                <span className="shrink-0 text-foreground/50">{(NAMED as readonly string[]).includes(detail.name) ? t(`asks.names.${detail.name as (typeof NAMED)[number]}`) : detail.name}</span>
                <span className="min-w-0 break-words">{detail.value}</span>
              </li>
            ))}
          </ul>
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
      <p className="px-4 pb-4 text-xs text-muted-foreground">{t("asks.why")}</p>
      <div className="grid grid-cols-[1fr_auto] gap-2 border-t border-primary/15 p-3">
        <Button className="h-9" disabled={sent} onClick={() => say(true)}>
          {t("asks.allow")}
        </Button>
        <Button className="h-9 px-4" variant="secondary" disabled={sent} onClick={() => say(false)}>
          {t("asks.notNow")}
        </Button>
      </div>
    </motion.div>
  );
}

function RunMap({ threadId, steps }: { threadId: Id<"assistantThreads">; steps: StepItem[] }) {
  const t = useTranslations("assistant");
  const reduceMotion = useReducedMotion();
  const undo = useMutation(api.assistant.undo.run);
  const toast = useAppToast();
  const height = ORIGIN + steps.length * (CARD + GAP) - GAP;
  const y = (i: number) => ORIGIN + i * (CARD + GAP) + CARD / 2;
  return (
    <motion.div
      className="relative grid grid-cols-[36px_1fr]"
      initial={false}
      animate={{ height: Math.max(0, height) }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.45, ease: EASE }}
    >
      <span className="absolute left-0.5 top-0 flex size-5 items-center justify-center rounded-md bg-primary/10">
        <LogoMark size={14} />
      </span>
      <svg className="overflow-visible" width={GUTTER} height={height} aria-hidden>
        {steps.map((step, i) => (
          <motion.path
            key={step.id}
            d={`M 12 22 C 12 ${22 + (y(i) - 22) * 0.75}, 16 ${y(i)}, ${GUTTER} ${y(i)}`}
            fill="none"
            stroke={KIND[viewOf(step.action).kind].tint}
            strokeWidth={2}
            strokeLinecap="round"
            initial={reduceMotion ? false : { pathLength: 0 }}
            animate={{ pathLength: 1, opacity: step.undone || step.status === "failed" || step.status === "declined" ? 0.25 : 1 }}
            transition={{ duration: 0.5, ease: EASE }}
          />
        ))}
      </svg>
      <div className="relative">
        <AnimatePresence initial={false}>
          {steps.map((step, i) => {
            const { kind, words } = viewOf(step.action);
            const working = step.status === "running";
            const faded = step.undone || step.status === "failed" || step.status === "declined";
            const state = step.status === "asking" ? t("steps.waiting") : step.status === "allowed" ? t("steps.allowed") : step.status === "declined" ? t("steps.declined") : null;
            // A step that waits for an answer, or was allowed or not, hasn't happened: it's named as what was asked, not as done.
            const asked = `steps.${words}.ask` as "steps.other.ask";
            const title =
              step.status === "asking" || step.status === "allowed" || step.status === "declined"
                ? t.has(asked) ? t(asked) : t("steps.other.ask")
                : t(`steps.${words}.${working || step.status === "failed" ? "doing" : "did"}`);
            return (
              <motion.div
                key={step.id}
                className="absolute inset-x-0"
                style={{ top: ORIGIN + i * (CARD + GAP) }}
                initial={{ opacity: 0, x: -8, scale: 0.97 }}
                animate={{ opacity: faded ? 0.55 : 1, x: 0, scale: 1 }}
                transition={{ duration: 0.4, ease: EASE, delay: reduceMotion ? 0 : 0.15 }}
              >
                <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-muted/40 px-3" style={{ height: CARD }}>
                  <KindTile kind={kind} working={working} />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className={cn("truncate text-sm font-semibold", step.undone && "line-through decoration-muted-foreground/60")}>{working ? <WorkingText>{title}</WorkingText> : title}</p>
                    <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-muted-foreground">
                      {step.status === "failed" ? (
                        <span className="truncate">{step.error ?? t("steps.interrupted")}</span>
                      ) : state ? (
                        <>
                          <Fact>{state}</Fact>
                          {step.subject ? <span className="truncate">{step.subject}</span> : null}
                        </>
                      ) : (
                        <>
                          {step.count !== undefined ? <Fact value={step.count}>{t("steps.found")}</Fact> : null}
                          {step.subject ? <span className="truncate">{step.subject}</span> : null}
                          {step.count === undefined && !step.subject ? <span className="truncate">{t(`steps.${words}.where`)}</span> : null}
                        </>
                      )}
                    </div>
                  </div>
                  {step.status === "failed" ? (
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
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
