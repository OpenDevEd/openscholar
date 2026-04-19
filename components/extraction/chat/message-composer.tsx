"use client";

import { useCallback, useState } from "react";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { SquareIcon } from "lucide-react";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { useAppToast } from "@/lib/toast";
import { optimisticallySendMessage } from "@convex-dev/agent/react";

export interface MessageComposerProps {
  threadId: string;
  jobIsGenerating: boolean;
}

export function MessageComposer({
  threadId,
  jobIsGenerating,
}: MessageComposerProps) {
  const t = useTranslations("extraction");
  const toast = useAppToast();
  const [text, setText] = useState("");

  const sendMessage = useMutation(
    api.chat.messages.sendMessage,
  ).withOptimisticUpdate(
    optimisticallySendMessage(api.chat.messages.listThreadMessages),
  );
  const abortGeneration = useMutation(api.chat.messages.abortGeneration);

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      const prompt = message.text.trim();
      if (!prompt) return;
      try {
        await sendMessage({ threadId, prompt });
        setText("");
      } catch (err) {
        toast.error(t("chatFailedMessage"));
        console.error("send message failed", err);
      }
    },
    [sendMessage, threadId, toast, t],
  );

  const handleStop = useCallback(() => {
    void abortGeneration({ threadId }).catch((err) => {
      console.error("abort failed", err);
    });
  }, [abortGeneration, threadId]);

  const isEmpty = text.trim().length === 0;
  const submitDisabled = isEmpty || jobIsGenerating;

  return (
    <PromptInput
      onSubmit={handleSubmit}
      className="border-t bg-background"
      data-generating={jobIsGenerating}
    >
      <PromptInputTextarea
        placeholder={t("chatEmptyStatePrompt")}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        disabled={jobIsGenerating}
        aria-label={t("chatSend")}
      />
      <PromptInputFooter>
        <PromptInputTools />
        <div className="flex items-center gap-1">
          {jobIsGenerating ? (
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              onClick={handleStop}
              aria-label={t("chatStop")}
              data-action="stop"
            >
              <SquareIcon className="size-3.5" />
            </Button>
          ) : null}
          <PromptInputSubmit
            disabled={submitDisabled}
            aria-label={t("chatSend")}
            data-action="send"
          />
        </div>
      </PromptInputFooter>
    </PromptInput>
  );
}
