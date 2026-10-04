"use client";

// What the assistant did in a reply, drawn like the AI settings routing map: a tile at the
// top, a tinted curve out to each step's card, one card per action it ran.

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, CircleAlert, Compass, FileText, FolderPlus, ListChecks, Search, TableProperties, Undo2, type AppIcon } from "@/components/icons";
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
  other: { icon: Compass, tint: "#94a3b8" },
} satisfies Record<string, { icon: AppIcon; tint: string }>;
type Kind = keyof typeof KIND;

/** The words for a kind of step: `assistant.steps.<words>` in the messages. */
type Words = "searches" | "search" | "searchHistory" | "bookmarks" | "ratings" | "saved" | "save" | "rate" | "remove" | "restore" | "collect" | "collections" | "collection" | "newCollection" | "renameCollection" | "screening" | "extractions" | "other";

/** Each action's kind of work and the words for it; one that isn't here shows as work in the account. */
const ACTIONS: Record<string, { kind: Kind; words: Words }> = {
  "research/records:listedSearches": { kind: "search", words: "searches" },
  "research/records:countSearches": { kind: "search", words: "searches" },
  "research/records:getSearch": { kind: "search", words: "search" },
  "research/records:searchHistory": { kind: "search", words: "searchHistory" },
  "research/records:listedShortcuts": { kind: "search", words: "bookmarks" },
  "research/records:ratingsOf": { kind: "paper", words: "ratings" },
  "library/queries:savedPaper": { kind: "paper", words: "saved" },
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
export function Steps({ threadId, steps }: { threadId: Id<"assistantThreads">; steps: StepItem[] }) {
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
            animate={{ pathLength: 1, opacity: step.undone || step.status === "failed" ? 0.25 : 1 }}
            transition={{ duration: 0.5, ease: EASE }}
          />
        ))}
      </svg>
      <div className="relative">
        <AnimatePresence initial={false}>
          {steps.map((step, i) => {
            const { kind, words } = viewOf(step.action);
            const working = step.status === "running";
            const faded = step.undone || step.status === "failed";
            const title = t(`steps.${words}.${working || step.status === "failed" ? "doing" : "did"}`);
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
