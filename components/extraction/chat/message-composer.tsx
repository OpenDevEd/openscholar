"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ComposerModelPicker } from "./composer-model-picker";
import type { ChatModelRow } from "./chat-model-types";
import { usePapersContext } from "./papers-context";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  applyInclusionPatchToSnapshot,
  buildBulkPatch,
} from "@/lib/chat/chat-papers-selection";
import { useAppToast } from "@/lib/toast";
import { toast } from "sonner";
import { optimisticallySendMessage } from "@convex-dev/agent/react";
import { cn } from "@/lib/utils";

interface MessageComposerProps {
  job: Doc<"extractionJobs">;
  threadId: string;
  chatModels?: ChatModelRow[];
}

export function MessageComposer({
  job,
  threadId,
  chatModels = [],
}: MessageComposerProps) {
  const t = useTranslations("extraction");
  const tc = useTranslations("composer");
  const appToast = useAppToast();
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);
  const reduceMotion = useReducedMotion();
  const jobIsGenerating = job.isGenerating ?? false;

  const {
    totalCount: totalSources,
    includedCount: includedSources,
    isLoading: sourcesLoading,
  } = usePapersContext();
  const hasNoSourcesIncluded = !sourcesLoading && includedSources === 0;

  const sendMessage = useMutation(
    api.chat.messages.sendMessage,
  ).withOptimisticUpdate(
    optimisticallySendMessage(api.chat.messages.listThreadMessages),
  );
  const abortGeneration = useMutation(api.chat.messages.abortGeneration);
  const swapModel = useMutation(api.chat.messages.swapModel);
  const bulkSetChatPapers = useMutation(
    api.chat.chatPapers.bulkSetChatPapers,
  ).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(
      api.chat.chatPapers.listChatSourcesWithInclusion,
      { jobId: job._id },
    );
    if (!current) return;
    const patch = buildBulkPatch(current.rows, args.sourceIds, args.included);
    localStore.setQuery(
      api.chat.chatPapers.listChatSourcesWithInclusion,
      { jobId: job._id },
      applyInclusionPatchToSnapshot(current, patch),
    );
  });

  const handleSubmit = useCallback(async () => {
    const prompt = text.trim();
    if (!prompt || jobIsGenerating) return;
    setText("");
    try {
      await sendMessage({ threadId, prompt });
      // Refocus the textarea after submit so the next keystroke goes
      // straight back to typing — no mouse round-trip.
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (err) {
      // Restore the text so the user doesn't lose their typing.
      setText(prompt);
      appToast.error(t("chatFailedMessage"));
      console.error("send message failed", err);
    }
  }, [text, jobIsGenerating, sendMessage, threadId, appToast, t]);

  const handleStop = useCallback(() => {
    void abortGeneration({ threadId })
      .then(() => {
        // Fired on mutation resolve (within ~50ms) rather than after the
        // stream actually cuts (can lag up to the poller interval + the
        // throttleMs window). The mutation IS the "I heard your click"
        // acknowledgement; users get instant feedback.
        toast.success(t("chatStopToast"));
      })
      .catch((err) => {
        console.error("abort failed", err);
        toast.error(t("chatStopToastFailure"));
      });
  }, [abortGeneration, threadId, t]);

  const handleModelChange = useCallback(
    (modelId: Id<"models">) => {
      void swapModel({ threadId, modelId })
        .then(() => toast.success(t("chatModelChanged")))
        .catch((err) => {
          appToast.error(t("chatFailedMessage"));
          console.error("swap model failed", err);
        });
    },
    [swapModel, threadId, appToast, t],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // IME composition guard: while a user is composing (Japanese,
      // Chinese, Korean), Enter should commit the composition — not
      // submit the message. Both `nativeEvent.isComposing` and the
      // 229 keyCode legacy signal show up; check both for safety.
      if (
        e.nativeEvent.isComposing ||
        e.nativeEvent.keyCode === 229 ||
        isComposingRef.current
      ) {
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true;
  }, []);
  const handleCompositionEnd = useCallback(() => {
    isComposingRef.current = false;
  }, []);

  // Keep focus when the disabled state flips from true → false (i.e.
  // generation finished while the user was waiting).
  const wasGeneratingRef = useRef(jobIsGenerating);
  useEffect(() => {
    if (wasGeneratingRef.current && !jobIsGenerating) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
    wasGeneratingRef.current = jobIsGenerating;
  }, [jobIsGenerating]);

  const isEmpty = text.trim().length === 0;
  const submitDisabled = isEmpty || hasNoSourcesIncluded;

  async function handleIncludeAllSources() {
    try {
      await bulkSetChatPapers({
        jobId: job._id,
        sourceIds: undefined,
        included: true,
      });
    } catch (err) {
      appToast.error(t("chatFailedMessage"));
      console.error("include-all from composer banner failed", err);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit();
      }}
      className="shrink-0 border-t bg-background p-3 sm:p-4"
      data-chat-composer="true"
      data-generating={jobIsGenerating}
    >
      {/*
        Screen-reader-only live region. The visible count lives on the
        desktop rail header and the mobile sheet trigger — a third
        visible "N of M" above the textarea is pure noise. We keep an
        sr-only aria-live region so SR users on mobile still hear
        inclusion changes when the sheet is closed, and so e2e + unit
        tests can still read the data-sources-* attributes.
      */}
      <p
        role="status"
        aria-live="polite"
        data-sources-count-state={hasNoSourcesIncluded ? "zero" : "normal"}
        data-sources-included={includedSources}
        data-sources-total={totalSources}
        className="sr-only"
      >
        {hasNoSourcesIncluded
          ? tc("sources.zero")
          : tc("sources.live", {
              included: includedSources,
              total: totalSources,
            })}
      </p>

      {hasNoSourcesIncluded && (
        <div
          role="alert"
          data-composer-empty-banner
          className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground"
        >
          <span className="text-foreground">{tc("sources.emptyBanner")}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-composer-include-all
            onClick={() => {
              void handleIncludeAllSources();
            }}
            className="text-foreground"
          >
            {tc("sources.includeAll")}
          </Button>
        </div>
      )}

      <motion.div
        layout={reduceMotion ? false : "size"}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className={cn(
          "group/composer flex flex-col rounded-2xl border bg-card shadow-sm transition-shadow",
          "focus-within:border-primary/40 focus-within:shadow-md focus-within:ring-2 focus-within:ring-ring/15",
        )}
      >
        <textarea
          ref={textareaRef}
          name="message"
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          placeholder={t("chatComposerPlaceholder")}
          aria-label={t("chatSend")}
          rows={1}
          className={cn(
            "field-sizing-content min-h-[44px] max-h-60 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm leading-relaxed outline-none",
            "placeholder:text-muted-foreground",
          )}
        />

        <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1">
          <ComposerModelPicker
            value={job.chatModelId ?? null}
            onChange={handleModelChange}
            disabled={jobIsGenerating}
            models={chatModels}
          />

          <div className="flex items-center gap-2">
            <span
              className="hidden items-center gap-2 text-[11px] text-muted-foreground sm:inline-flex"
              aria-hidden
            >
              <kbd className="rounded border border-border/60 bg-background px-1 py-0.5 font-mono text-[10px] leading-none">
                {t("chatHintEnter")}
              </kbd>
              <kbd className="rounded border border-border/60 bg-background px-1 py-0.5 font-mono text-[10px] leading-none">
                {t("chatHintShiftEnter")}
              </kbd>
            </span>

            <AnimatePresence mode="wait" initial={false}>
              {jobIsGenerating ? (
                <motion.div
                  key="stop"
                  initial={reduceMotion ? false : { scale: 0.85, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={reduceMotion ? undefined : { scale: 0.85, opacity: 0 }}
                  transition={{ duration: 0.12, ease: "easeOut" }}
                >
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    onClick={handleStop}
                    aria-label={t("chatStop")}
                    data-action="stop"
                    className="size-8 rounded-full"
                  >
                    <SquareIcon className="size-3.5 fill-current" />
                  </Button>
                </motion.div>
              ) : (
                <motion.div
                  key="send"
                  initial={reduceMotion ? false : { scale: 0.85, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={reduceMotion ? undefined : { scale: 0.85, opacity: 0 }}
                  transition={{ duration: 0.12, ease: "easeOut" }}
                >
                  <Button
                    type="submit"
                    size="icon"
                    disabled={submitDisabled}
                    aria-label={t("chatSend")}
                    data-action="send"
                    className="size-8 rounded-full disabled:opacity-40"
                  >
                    <ArrowUpIcon className="size-4" />
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </form>
  );
}
