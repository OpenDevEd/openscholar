"use client";

import { Fragment, memo, useMemo } from "react";
import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { useUIMessages, type UIMessage } from "@convex-dev/agent/react";
import {
  Conversation,
  ConversationContent,
} from "@/components/ai-elements/conversation";
import { JumpToLatestPill } from "./jump-to-latest-pill";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { MessageActions } from "./message-actions";
import { PaperCitation, type PaperCitationTarget } from "./paper-citation";
import { SuggestionChips } from "./suggestion-chips";
import {
  resolvePaperReference,
  type ResolvablePaper,
} from "@/lib/chat/resolve-paper";
import { cn } from "@/lib/utils";
import { AlertCircleIcon, RefreshCwIcon } from "lucide-react";
import { useMutation } from "convex/react";

interface MessageListProps {
  threadId: string;
  jobId: Id<"extractionJobs">;
}

type ResolvedPaper = PaperCitationTarget & { _id: string };

/**
 * Splits the children of a <p> rendered by Streamdown. When a text node
 * contains `[P{n}]` tokens, we replace them with interactive
 * <PaperCitation> components that hover-card the paper metadata.
 *
 * Streamdown passes children as either a string or ReactNode[] — we
 * traverse both in the same way.
 */
function splitTextForChips(
  text: string,
  papers: ResolvedPaper[],
): React.ReactNode[] {
  const matches = resolvePaperReference<ResolvedPaper>(text, papers);
  if (matches.length === 0) return [text];

  const out: React.ReactNode[] = [];
  let cursor = 0;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (m.start > cursor) {
      out.push(text.slice(cursor, m.start));
    }
    out.push(
      <PaperCitation
        key={`cite-${i}-${m.index}`}
        index={m.index}
        paper={m.paper}
      />,
    );
    cursor = m.end;
  }
  if (cursor < text.length) {
    out.push(text.slice(cursor));
  }
  return out;
}

interface CitationAwareParagraphProps {
  children?: React.ReactNode;
  papers: ResolvedPaper[];
}

/**
 * Custom Streamdown paragraph renderer. Walks children; for text nodes,
 * splits on `[P{n}]` and splices in <PaperCitation> nodes.
 */
function CitationAwareParagraph({
  children,
  papers,
}: CitationAwareParagraphProps) {
  const rendered = useMemo(() => {
    const nodes = Array.isArray(children) ? children : [children];
    const out: React.ReactNode[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (typeof node === "string") {
        out.push(...splitTextForChips(node, papers));
      } else {
        out.push(node);
      }
    }
    return out;
  }, [children, papers]);

  return <p>{rendered}</p>;
}

function buildStreamdownComponents(papers: ResolvedPaper[]) {
  return {
    p: (props: { children?: React.ReactNode }) => (
      <CitationAwareParagraph papers={papers}>
        {props.children}
      </CitationAwareParagraph>
    ),
  } as const;
}

function getMessageText(message: UIMessage): string {
  if (message.text) return message.text;
  return message.parts
    .filter(
      (p): p is Extract<UIMessage["parts"][number], { type: "text" }> =>
        p.type === "text",
    )
    .map((p) => p.text)
    .join("");
}

interface MessageRowProps {
  message: UIMessage;
  papers: ResolvedPaper[];
  isLastAssistant: boolean;
  threadId: string;
  errorLabel: string;
  retryLabel: string;
  onRetry: () => void;
}

const MessageRow = memo(function MessageRow({
  message,
  papers,
  isLastAssistant,
  threadId,
  errorLabel,
  retryLabel,
  onRetry,
}: MessageRowProps) {
  const text = getMessageText(message);
  const isStreaming = message.status === "streaming";
  const isFailed = message.status === "failed";
  const isEmpty = text.length === 0;
  const isUser = message.role === "user";

  const streamdownComponents = useMemo(
    () => buildStreamdownComponents(papers),
    [papers],
  );

  // Agent message metadata may carry an error string.
  const metaError =
    typeof message.metadata === "object" && message.metadata
      ? ((message.metadata as { error?: unknown }).error as string | undefined)
      : undefined;

  return (
    <li
      data-role={message.role}
      data-status={message.status}
      data-streaming={isStreaming}
      data-error={isFailed}
      data-message-id={message.id}
      aria-busy={isStreaming}
      className="flex flex-col gap-1"
    >
      <Message from={message.role}>
        <MessageContent>
          {isUser ? (
            <div className="whitespace-pre-wrap">{text}</div>
          ) : isStreaming && isEmpty ? (
            <Shimmer>{"…"}</Shimmer>
          ) : (
            <MessageResponse components={streamdownComponents}>
              {text}
            </MessageResponse>
          )}
        </MessageContent>
        {!isUser ? (
          <MessageActions
            message={message}
            isLastAssistant={isLastAssistant}
            threadId={threadId}
          />
        ) : null}
      </Message>
      {isFailed && isEmpty ? (
        <Alert
          variant="destructive"
          className="self-start"
          data-message-error="true"
        >
          <AlertCircleIcon className="size-4" />
          <AlertTitle>{errorLabel}</AlertTitle>
          <AlertDescription>
            <span className="mb-2 block">{metaError ?? errorLabel}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={onRetry}
              aria-label={retryLabel}
              data-action="retry-inline"
            >
              <RefreshCwIcon className="mr-2 size-3.5" />
              {retryLabel}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
    </li>
  );
});

export function MessageList({ threadId, jobId }: MessageListProps) {
  const t = useTranslations("extraction");
  const regenerate = useMutation(api.chat.messages.regenerateLastAssistant);

  const { results } = useUIMessages(
    api.chat.messages.listThreadMessages,
    { threadId },
    { initialNumItems: 20, stream: true },
  );

  const sourcesQuery = useQuery(api.extraction.queries.getJobSources, {
    jobId,
  });

  const papers = useMemo<ResolvedPaper[]>(() => {
    if (!sourcesQuery || sourcesQuery.status !== "ok") return [];
    // Mirrors lib/chat/render-corpus.ts: sort by openalexId ASC so the
    // index that becomes [P{n}] matches the server-rendered corpus.
    const rows = [...sourcesQuery.sources];
    const withIds: typeof rows = [];
    const withoutIds: typeof rows = [];
    for (const row of rows) {
      if (row.openalexId) withIds.push(row);
      else withoutIds.push(row);
    }
    withIds.sort((a, b) =>
      a.openalexId! < b.openalexId!
        ? -1
        : a.openalexId! > b.openalexId!
          ? 1
          : 0,
    );
    return [...withIds, ...withoutIds].map((row) => ({
      _id: row._id,
      title: row.title,
      authors: row.authors,
      year: row.year,
      abstract: row.abstract,
      openalexId: row.openalexId,
      doi: row.doi,
    }));
  }, [sourcesQuery]);

  const lastAssistantId = useMemo(() => {
    for (let i = results.length - 1; i >= 0; i--) {
      if (results[i].role === "assistant") return results[i].id;
    }
    return null;
  }, [results]);

  const handleRetry = () => {
    void regenerate({ threadId }).catch((err) => {
      console.error("retry failed", err);
    });
  };

  const errorLabel = t("chatFailedMessage");
  const retryLabel = t("chatRetryResponse");

  if (results.length === 0) {
    return (
      <div
        className="flex flex-1 flex-col overflow-y-auto"
        data-message-list="empty"
      >
        <SuggestionChips threadId={threadId} />
      </div>
    );
  }

  return (
    <Conversation
      className={cn("flex-1")}
      data-message-list="populated"
      role="presentation"
    >
      <ConversationContent>
        <ol
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          className="flex flex-col gap-8"
        >
          {results.map((message) => (
            <Fragment key={message.id}>
              <MessageRow
                message={message as UIMessage}
                papers={papers}
                isLastAssistant={message.id === lastAssistantId}
                threadId={threadId}
                errorLabel={errorLabel}
                retryLabel={retryLabel}
                onRetry={handleRetry}
              />
            </Fragment>
          ))}
        </ol>
      </ConversationContent>
      <JumpToLatestPill messageCount={results.length} />
    </Conversation>
  );
}
