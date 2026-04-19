"use client";

import { TwoColumnLayout } from "@/components/layout/two-column-layout";
import type { Doc } from "@/convex/_generated/dataModel";
import { ChatHeader } from "./chat-header";
import { MessageComposer } from "./message-composer";
import { MessageList } from "./message-list";
import { PapersInContextSidebar } from "./papers-in-context-sidebar";
import { useChatShortcuts } from "./use-chat-shortcuts";

interface ChatJobViewProps {
  job: Doc<"extractionJobs">;
  threadId: string;
}

export function ChatJobView({ job, threadId }: ChatJobViewProps) {
  useChatShortcuts();

  return (
    <TwoColumnLayout
      sidebarSide="right"
      leftColumn={<PapersInContextSidebar jobId={job._id} />}
      rightColumn={
        <div
          className="flex h-full min-h-0 flex-col"
          data-mode="chat"
          data-job-id={job._id}
        >
          <ChatHeader job={job} threadId={threadId} />
          <MessageList threadId={threadId} jobId={job._id} />
          <MessageComposer job={job} threadId={threadId} />
        </div>
      }
    />
  );
}
