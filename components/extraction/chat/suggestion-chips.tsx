"use client";

import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRightIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useAppToast } from "@/lib/toast";
import { optimisticallySendMessage } from "@convex-dev/agent/react";
import { cn } from "@/lib/utils";
import { usePapersContext } from "./papers-context";

interface SuggestionChipsProps {
  threadId: string;
}

const SUGGESTION_KEYS = [
  "suggestionSummarise",
  "suggestionThemes",
  "suggestionMostCited",
  "suggestionCompare",
] as const;

export function SuggestionChips({ threadId }: SuggestionChipsProps) {
  const t = useTranslations("extraction");
  const toast = useAppToast();
  const reduceMotion = useReducedMotion();
  const { totalCount: paperCount } = usePapersContext();

  const sendMessage = useMutation(
    api.chat.messages.sendMessage,
  ).withOptimisticUpdate(
    optimisticallySendMessage(api.chat.messages.listThreadMessages),
  );

  const suggestions = useMemo(
    () => SUGGESTION_KEYS.map((key) => ({ key, text: t(key) })),
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
      className="mx-auto flex h-full w-full max-w-xl flex-col justify-center gap-7 p-6"
      data-empty-state="true"
    >
      <motion.header
        initial={reduceMotion ? false : { opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
        className="flex flex-col gap-3"
      >
        {paperCount > 0 ? (
          <div
            className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
            data-paper-context="true"
            data-paper-count={paperCount}
          >
            <span
              className="inline-block size-1 rounded-full bg-primary"
              aria-hidden
            />
            <span>{t("chatEmptyPaperCount", { count: paperCount })}</span>
          </div>
        ) : null}
        <h2 className="text-balance text-[26px] font-medium leading-[1.15] tracking-tight text-foreground">
          {t("chatEmptyHeadline")}
        </h2>
      </motion.header>

      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: 0.3,
          ease: "easeOut",
          delay: reduceMotion ? 0 : 0.06,
        }}
        className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card shadow-xs"
        role="list"
        data-suggestions="true"
      >
        {suggestions.map((s, i) => (
          <button
            key={s.key}
            type="button"
            role="listitem"
            onClick={() => handleSelect(s.text)}
            data-suggestion-key={s.key}
            data-suggestion-index={i}
            className={cn(
              "group relative flex w-full items-center gap-4 px-4 py-3 text-left text-sm text-foreground",
              "transition-colors hover:bg-accent/40 focus-visible:bg-accent/40",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40",
            )}
          >
            <span
              className="w-5 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/70"
              aria-hidden
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="min-w-0 flex-1 truncate">{s.text}</span>
            <ArrowRightIcon
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground/60 transition-all",
                reduceMotion
                  ? "opacity-60"
                  : "-translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100",
              )}
              aria-hidden
            />
          </button>
        ))}
      </motion.div>

      <p
        className="hidden text-[11px] text-muted-foreground sm:block"
        data-shortcut-hint="true"
      >
        {t("chatShortcutFocus")}
      </p>
    </div>
  );
}
