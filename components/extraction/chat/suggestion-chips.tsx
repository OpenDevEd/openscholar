"use client";

import { useMutation, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRightIcon,
  GitCompareArrowsIcon,
  type LucideIcon,
  NetworkIcon,
  QuoteIcon,
  ScrollTextIcon,
  SparklesIcon,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAppToast } from "@/lib/toast";
import { optimisticallySendMessage } from "@convex-dev/agent/react";
import { cn } from "@/lib/utils";

interface SuggestionChipsProps {
  threadId: string;
  jobId?: Id<"extractionJobs">;
}

const SUGGESTION_DEFS: ReadonlyArray<{
  key: "suggestionSummarise" | "suggestionThemes" | "suggestionMostCited" | "suggestionCompare";
  icon: LucideIcon;
}> = [
  { key: "suggestionSummarise", icon: ScrollTextIcon },
  { key: "suggestionThemes", icon: NetworkIcon },
  { key: "suggestionMostCited", icon: QuoteIcon },
  { key: "suggestionCompare", icon: GitCompareArrowsIcon },
];

export function SuggestionChips({ threadId, jobId }: SuggestionChipsProps) {
  const t = useTranslations("extraction");
  const toast = useAppToast();
  const reduceMotion = useReducedMotion();

  const sendMessage = useMutation(
    api.chat.messages.sendMessage,
  ).withOptimisticUpdate(
    optimisticallySendMessage(api.chat.messages.listThreadMessages),
  );

  // Optional jobId — when present, surface paper count in the empty
  // hero. Skips the query when not provided so this component remains
  // testable in isolation without a Convex job stub.
  const sources = useQuery(
    api.extraction.queries.getJobSources,
    jobId ? { jobId } : "skip",
  );
  const paperCount =
    sources && sources.status === "ok" ? sources.sources.length : null;

  const suggestions = useMemo(
    () => SUGGESTION_DEFS.map((def) => ({ ...def, text: t(def.key) })),
    [t],
  );

  const handleSelect = useCallback(
    (prompt: string) => {
      void sendMessage({ threadId, prompt }).catch((err) => {
        toast.error(t("chatFailedMessage"), undefined);
        console.error("suggestion send failed", err);
      });
    },
    [sendMessage, threadId, toast, t],
  );

  return (
    <div
      className="mx-auto flex h-full w-full max-w-2xl flex-col items-center justify-center gap-8 p-6"
      data-empty-state="true"
    >
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: "easeOut" }}
        className="flex flex-col items-center gap-3 text-center"
      >
        <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 via-primary/10 to-primary/5 text-primary shadow-sm">
          <SparklesIcon className="size-6" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          {t("chatEmptyHeadline")}
        </h2>
        {paperCount !== null ? (
          <p className="text-sm text-muted-foreground">
            {t("chatEmptyPaperCount", { count: paperCount })}
          </p>
        ) : null}
      </motion.div>

      <div
        className="grid w-full gap-3 sm:grid-cols-2"
        role="list"
        data-suggestions="true"
      >
        {suggestions.map((s, i) => {
          const Icon = s.icon;
          return (
            <motion.button
              key={s.key}
              type="button"
              role="listitem"
              onClick={() => handleSelect(s.text)}
              data-suggestion-key={s.key}
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.28,
                ease: "easeOut",
                delay: reduceMotion ? 0 : 0.08 + i * 0.06,
              }}
              whileHover={
                reduceMotion ? undefined : { y: -2, transition: { duration: 0.15 } }
              }
              whileTap={reduceMotion ? undefined : { scale: 0.98 }}
              className={cn(
                "group flex items-start gap-3 rounded-xl border bg-card p-4 text-left shadow-sm",
                "transition-colors hover:border-primary/40 hover:bg-accent/30",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1 text-sm text-foreground">
                {s.text}
              </span>
              <ArrowRightIcon className="mt-1 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </motion.button>
          );
        })}
      </div>

      <p
        className="hidden text-[11px] text-muted-foreground sm:block"
        data-shortcut-hint="true"
      >
        {t("chatShortcutFocus")}
      </p>
    </div>
  );
}
