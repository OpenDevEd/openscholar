"use client";

import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useRef, useState } from "react";
import { FileText } from "@/components/icons";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { api } from "@/convex/_generated/api";
import { optimisticallySendMessage } from "@convex-dev/agent/react";
import { usePapersContext } from "./papers-context";
import { ChatErrorAlert } from "./chat-error-alert";
import { classifyChatError, serializeChatError } from "@/lib/errors/taxonomy";

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
  const { totalCount: paperCount } = usePapersContext();
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const sendRequestSeq = useRef(0);

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
      const requestId = ++sendRequestSeq.current;
      setLastPrompt(prompt);
      setSendError(null);
      void sendMessage({ threadId, prompt }).catch((err) => {
        if (sendRequestSeq.current !== requestId) return;
        setSendError(serializeChatError(classifyChatError(err)));
        console.error("suggestion send failed", err);
      });
    },
    [sendMessage, threadId],
  );

  return (
    <div
      className="mx-auto flex h-full w-full max-w-xl flex-col justify-center gap-7 p-6"
      data-empty-state="true"
    >
      <header className="flex flex-col gap-3">
        {paperCount > 0 ? (
          <div
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            data-paper-context="true"
            data-paper-count={paperCount}
          >
            <FileText className="size-3.5 text-primary" aria-hidden />
            <span>{t("chatEmptyPaperCount", { count: paperCount })}</span>
          </div>
        ) : null}
        <h2 className="text-balance text-2xl font-medium leading-[1.15] tracking-tight text-foreground">
          {t("chatEmptyHeadline")}
        </h2>
      </header>

      <Suggestions className="w-full flex-wrap" data-suggestions="true">
        {suggestions.map((s) => (
          <Suggestion
            key={s.key}
            suggestion={s.text}
            onClick={handleSelect}
            data-suggestion-key={s.key}
          />
        ))}
      </Suggestions>

      {sendError ? (
        <ChatErrorAlert
          rawError={sendError}
          onRetry={() => {
            if (lastPrompt) handleSelect(lastPrompt);
          }}
          canRetry={lastPrompt !== null}
          models={[]}
        />
      ) : null}

      <p
        className="hidden text-2xs text-muted-foreground sm:block"
        data-shortcut-hint="true"
      >
        {t("chatShortcutFocus")}
      </p>
    </div>
  );
}
