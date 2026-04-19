"use client";

import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import {
  Suggestion,
  Suggestions,
} from "@/components/ai-elements/suggestion";
import { api } from "@/convex/_generated/api";
import { useAppToast } from "@/lib/toast";
import { optimisticallySendMessage } from "@convex-dev/agent/react";

export interface SuggestionChipsProps {
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
      className="flex h-full flex-col items-center justify-center gap-6 px-6 text-center"
      data-empty-state="true"
    >
      <p className="text-sm text-muted-foreground">
        {t("chatEmptyStatePrompt")}
      </p>
      <Suggestions className="justify-center">
        {suggestions.map((s) => (
          <Suggestion
            key={s.key}
            suggestion={s.text}
            onClick={handleSelect}
            data-suggestion-key={s.key}
          />
        ))}
      </Suggestions>
    </div>
  );
}
