"use client";

import { Fragment, memo, useMemo } from "react";
import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { useUIMessages, type UIMessage } from "@convex-dev/agent/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertCircleIcon, RefreshCwIcon } from "lucide-react";
import { useMutation } from "convex/react";
import {
  Conversation,
  ConversationContent,
} from "@/components/ai-elements/conversation";
import { JumpToLatestPill } from "./jump-to-latest-pill";
import { MessageResponse } from "@/components/ai-elements/message";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { MessageActions } from "./message-actions";
import { PaperCitation, type PaperCitationTarget } from "./paper-citation";
import { SuggestionChips } from "./suggestion-chips";
import { StreamingCursor } from "./streaming-cursor";
import { TypingDots } from "./typing-dots";
import {
  resolvePaperReferences,
  type ResolvablePaper,
} from "@/lib/chat/resolve-paper";
import { cn } from "@/lib/utils";

interface MessageListProps {
  threadId: string;
  jobId: Id<"extractionJobs">;
  chatModelId: Id<"models"> | null;
}

type ResolvedPaper = PaperCitationTarget & { _id: string };

function splitTextForChips(
  text: string,
  papers: ResolvedPaper[],
): React.ReactNode[] {
  const groups = resolvePaperReferences<ResolvedPaper>(text, papers);
  if (groups.length === 0) return [text];

  const out: React.ReactNode[] = [];
  let cursor = 0;
  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    if (group.start > cursor) {
      out.push(text.slice(cursor, group.start));
    }
    for (let c = 0; c < group.citations.length; c++) {
      const citation = group.citations[c];
      out.push(
        <PaperCitation
          key={`cite-${g}-${c}-${citation.index}`}
          index={citation.index}
          paper={citation.paper}
        />,
      );
    }
    cursor = group.end;
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
  isFirstInGroup: boolean;
  threadId: string;
  chatModelId: Id<"models"> | null;
  errorLabel: string;
  retryLabel: string;
  onRetry: () => void;
  reduceMotion: boolean;
}

const MessageRow = memo(function MessageRow({
  message,
  papers,
  isLastAssistant,
  isFirstInGroup,
  threadId,
  chatModelId,
  errorLabel,
  retryLabel,
  onRetry,
  reduceMotion,
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

  const metaError =
    typeof message.metadata === "object" && message.metadata
      ? ((message.metadata as { error?: unknown }).error as string | undefined)
      : undefined;

  return (
    <motion.li
      data-role={message.role}
      data-status={message.status}
      data-streaming={isStreaming}
      data-error={isFailed}
      data-message-id={message.id}
      data-first-in-group={isFirstInGroup ? "true" : undefined}
      aria-busy={isStreaming}
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className={cn(
        "group/message flex flex-col",
        isUser ? "items-end" : "items-start",
        isFirstInGroup ? "mt-2" : "mt-1",
      )}
    >
      {!isUser && isFirstInGroup ? (
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          <span
            className="inline-block size-1 rounded-full bg-primary"
            aria-hidden
          />
          <span>Assistant</span>
        </div>
      ) : null}

      <div
        className={cn(
          "min-w-0",
          isUser
            ? "max-w-[85%] rounded-2xl rounded-br-sm bg-primary/10 px-4 py-2.5 text-sm text-foreground"
            : "w-full max-w-3xl text-sm leading-relaxed text-foreground",
        )}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap break-words">{text}</div>
        ) : isStreaming && isEmpty ? (
          <TypingDots />
        ) : (
          <div className="min-w-0">
            <MessageResponse components={streamdownComponents}>
              {text}
            </MessageResponse>
            {isStreaming && !isEmpty ? <StreamingCursor /> : null}
          </div>
        )}
      </div>

      {!isUser && !isEmpty ? (
        <div className="mt-1">
          <MessageActions
            message={message}
            isLastAssistant={isLastAssistant}
            threadId={threadId}
            chatModelId={chatModelId}
          />
        </div>
      ) : null}

      {isFailed && isEmpty ? (
        <Alert
          variant="destructive"
          className="mt-2 self-start"
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
    </motion.li>
  );
});

export function MessageList({
  threadId,
  jobId,
  chatModelId,
}: MessageListProps) {
  const t = useTranslations("extraction");
  const reduceMotion = useReducedMotion() ?? false;
  const regenerate = useMutation(api.chat.messages.regenerateLastAssistant);

  const { results, status } = useUIMessages(
    api.chat.messages.listThreadMessages,
    { threadId },
    { initialNumItems: 20, stream: true },
  );

  const isLoadingFirstPage =
    status === "LoadingFirstPage" && results.length === 0;

  const sourcesQuery = useQuery(api.extraction.queries.getJobSources, {
    jobId,
  });

  const papers = useMemo<ResolvedPaper[]>(() => {
    if (!sourcesQuery || sourcesQuery.status !== "ok") return [];
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
    if (isLoadingFirstPage) {
      return (
        <motion.div
          className="flex min-h-0 flex-1"
          data-message-list="loading"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{
            delay: 3,
            duration: reduceMotion ? 0 : 0.4,
            ease: "easeOut",
          }}
        >
          <AuthStatePanel
            variant="loading"
            layout="fullscreen"
            loadingStyle="spinner"
            title={t("chatRetryLoadingMessages")}
          />
        </motion.div>
      );
    }
    return (
      <div
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain"
        data-message-list="empty"
      >
        <SuggestionChips threadId={threadId} jobId={jobId} />
      </div>
    );
  }

  return (
    <Conversation
      // `min-h-0` releases the default flex `min-height: auto` so the
      // StickToBottom internal `overflow: auto` can actually scroll
      // instead of pushing the composer off-screen.
      className={cn("min-h-0 flex-1 overscroll-contain")}
      data-message-list="populated"
      role="presentation"
    >
      <ConversationContent>
        <ol
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          className="mx-auto flex w-full max-w-3xl flex-col gap-2"
        >
          <AnimatePresence initial={false}>
            {results.map((message, i) => {
              const prev = results[i - 1];
              const isFirstInGroup = !prev || prev.role !== message.role;
              return (
                <Fragment key={message.id}>
                  <MessageRow
                    message={message as UIMessage}
                    papers={papers}
                    isLastAssistant={message.id === lastAssistantId}
                    isFirstInGroup={isFirstInGroup}
                    threadId={threadId}
                    chatModelId={chatModelId}
                    errorLabel={errorLabel}
                    retryLabel={retryLabel}
                    onRetry={handleRetry}
                    reduceMotion={reduceMotion}
                  />
                </Fragment>
              );
            })}
          </AnimatePresence>
        </ol>
      </ConversationContent>
      <JumpToLatestPill messageCount={results.length} />
    </Conversation>
  );
}
