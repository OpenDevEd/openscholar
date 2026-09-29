"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { ComposerModelPicker } from "./composer-model-picker";
import { ComposerEffortPicker } from "./composer-effort-picker";
import type { Effort } from "@/lib/ai/core/call-options";
import { WebSearchToggle } from "./web-search-toggle";
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
import { ChatErrorAlert } from "./chat-error-alert";
import { classifyChatError, serializeChatError } from "@/lib/errors/taxonomy";

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
  const [sendError, setSendError] = useState<string | null>(null);
  const [stopPending, setStopPending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendRequestSeq = useRef(0);
  const jobIsGenerating = job.isGenerating ?? false;
  const generationAttemptId = job.chatGenerationAttemptId ?? null;
  const selectedModel = chatModels.find((m) => m._id === job.chatModelId);

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
  const setChatEffort = useMutation(api.chat.messages.setChatEffort);
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
    const requestId = ++sendRequestSeq.current;
    setSendError(null);
    setText("");
    try {
      await sendMessage({ threadId, prompt });
      // Refocus the textarea after submit so the next keystroke goes
      // straight back to typing — no mouse round-trip.
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (err) {
      if (sendRequestSeq.current !== requestId) return;
      // Restore the text so the user doesn't lose their typing.
      setText(prompt);
      setSendError(serializeChatError(classifyChatError(err)));
      console.error("send message failed", err);
    }
  }, [text, jobIsGenerating, sendMessage, threadId]);

  const handleStop = useCallback(() => {
    if (!generationAttemptId || stopPending) return;
    setStopPending(true);
    void abortGeneration({ threadId, generationAttemptId })
      .catch((err) => {
        console.error("abort failed", err);
      })
      .finally(() => {
        setStopPending(false);
      });
  }, [abortGeneration, generationAttemptId, stopPending, threadId]);

  const handleModelChange = useCallback(
    (modelId: Id<"models">, effort?: Effort) => {
      void swapModel({ threadId, modelId, ...(effort && { effort }) })
        .then(() => toast.success(t("chatModelChanged")))
        .catch((err) => {
          appToast.error(t("chatFailedMessage"));
          console.error("swap model failed", err);
        });
    },
    [swapModel, threadId, appToast, t],
  );

  const handleEffortChange = useCallback(
    (effort: Effort) => {
      void setChatEffort({ threadId, effort }).catch((err) => {
        appToast.error(t("chatFailedMessage"));
        console.error("set chat effort failed", err);
      });
    },
    [setChatEffort, threadId, appToast, t],
  );

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
    <div
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

      {sendError ? (
        <ChatErrorAlert
          rawError={sendError}
          onRetry={() => {
            void handleSubmit();
          }}
          canRetry={!jobIsGenerating && !hasNoSourcesIncluded}
          chatModelId={job.chatModelId ?? null}
          models={chatModels}
        />
      ) : null}

      <PromptInput
        onSubmit={() => {
          void handleSubmit();
        }}
        className="[&_[data-slot=input-group]]:rounded-2xl [&_[data-slot=input-group]]:bg-card"
      >
        <PromptInputTextarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.currentTarget.value);
            if (sendError) setSendError(null);
          }}
          placeholder={t("chatComposerPlaceholder")}
          aria-label={t("chatComposerPlaceholder")}
          className="min-h-11"
        />
        <PromptInputFooter>
          {/* On a narrow composer the model name truncates; the other controls keep their size. */}
          <PromptInputTools className="[&>*:not(:first-child)]:shrink-0">
            <ComposerModelPicker
              value={job.chatModelId ?? null}
              effort={job.chatEffort}
              onChange={handleModelChange}
              disabled={jobIsGenerating}
              models={chatModels}
            />
            <ComposerEffortPicker
              model={selectedModel}
              value={job.chatEffort}
              onChange={handleEffortChange}
              disabled={jobIsGenerating}
            />
            <WebSearchToggle
              threadId={threadId}
              enabled={Boolean(job.webSearchEnabled)}
              modelSupportedParameters={selectedModel?.supportedParameters}
              isGenerating={jobIsGenerating}
            />
          </PromptInputTools>
          <PromptInputSubmit
            status={jobIsGenerating ? "streaming" : undefined}
            onStop={handleStop}
            disabled={
              jobIsGenerating
                ? !generationAttemptId || stopPending
                : submitDisabled
            }
            aria-label={jobIsGenerating ? t("chatStop") : t("chatSend")}
            data-action={jobIsGenerating ? "stop" : "send"}
            className="rounded-full"
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
