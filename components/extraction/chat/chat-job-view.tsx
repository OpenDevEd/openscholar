"use client";

import { TwoColumnLayout } from "@/components/layout/two-column-layout";
import type { Doc } from "@/convex/_generated/dataModel";
import { ChatHeader } from "./chat-header";
import { ChatPapersProvider } from "./papers-context";
import { MessageComposer } from "./message-composer";
import { MessageList } from "./message-list";
import { SourcesPanel } from "./sources-panel";
import { useChatShortcuts } from "./use-chat-shortcuts";

interface ChatJobViewProps {
  job: Doc<"extractionJobs">;
  threadId: string;
}

export function ChatJobView({ job, threadId }: ChatJobViewProps) {
  useChatShortcuts();

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
            <ChatHeader job={job} threadId={threadId} />
            <MessageList
              threadId={threadId}
              jobId={job._id}
              chatModelId={job.chatModelId ?? null}
            />
            <MessageComposer job={job} threadId={threadId} />
          </div>
        }
      />
    </ChatPapersProvider>
  );
}
