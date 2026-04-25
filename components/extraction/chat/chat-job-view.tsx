"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { TwoColumnLayout } from "@/components/layout/two-column-layout";
import type { Doc } from "@/convex/_generated/dataModel";
import { ChatHeader } from "./chat-header";
import { ChatPapersProvider } from "./papers-context";
import { MessageComposer } from "./message-composer";
import { MessageList } from "./message-list";
import { SourcesPanel } from "./sources-panel";
import { useChatShortcuts } from "./use-chat-shortcuts";
import { sortChatModels } from "./chat-model-types";

interface ChatJobViewProps {
  job: Doc<"extractionJobs">;
  threadId: string;
}

export function ChatJobView({ job, threadId }: ChatJobViewProps) {
  useChatShortcuts();
  const [messageGenerationActive, setMessageGenerationActive] = useState<{
    active: boolean;
    generationAttemptId?: string;
  }>({ active: false });
  const rawChatModels = useQuery(api.chat.model.listChatModels, {});
  const chatModels = useMemo(
    () => (rawChatModels ? sortChatModels(rawChatModels) : []),
    [rawChatModels],
  );
  const effectiveJob = useMemo(
    () =>
      messageGenerationActive.active && job.isGenerating !== true
        ? {
            ...job,
            isGenerating: true,
            chatGenerationAttemptId:
              messageGenerationActive.generationAttemptId ??
              job.chatGenerationAttemptId,
          }
        : job,
    [
      job,
      messageGenerationActive.active,
      messageGenerationActive.generationAttemptId,
    ],
  );
  const handleGenerationActivityChange = useCallback(
    (active: boolean, generationAttemptId?: string) => {
      setMessageGenerationActive((current) =>
        current.active === active &&
        current.generationAttemptId === generationAttemptId
          ? current
          : { active, generationAttemptId },
      );
    },
    [],
  );

  return (
    <ChatPapersProvider jobId={job._id}>
      <TwoColumnLayout
        sidebarSide="right"
        // Bound the chat shell to its parent so the message list — not the
        // page — owns the scroll. `h-full` resolves against the bounded
        // app content shell; `min-h-0` releases the flex default so an
        // overflowing child can shrink and scroll; `overflow-hidden`
        // clips so the scroll bar appears on the inner pane.
        className="h-full min-h-0 overflow-hidden"
        leftColumn={<SourcesPanel jobId={job._id} />}
        rightColumn={
          <div
            className="flex h-full min-h-0 flex-col overflow-hidden"
            data-mode="chat"
            data-job-id={job._id}
          >
            <ChatHeader job={effectiveJob} threadId={threadId} />
            <MessageList
              threadId={threadId}
              jobId={effectiveJob._id}
              chatModelId={effectiveJob.chatModelId ?? null}
              chatModels={chatModels}
              isJobGenerating={job.isGenerating === true}
              jobError={job.error ?? null}
              onGenerationActivityChange={handleGenerationActivityChange}
            />
            <MessageComposer
              job={effectiveJob}
              threadId={threadId}
              chatModels={chatModels}
            />
          </div>
        }
      />
    </ChatPapersProvider>
  );
}
