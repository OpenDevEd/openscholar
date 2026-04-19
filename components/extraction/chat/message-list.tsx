"use client";

import {
  Children,
  Fragment,
  cloneElement,
  createElement,
  isValidElement,
  memo,
  useMemo,
  type ReactNode,
} from "react";
import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { useUIMessages, type UIMessage } from "@convex-dev/agent/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMutation } from "convex/react";
import {
  Conversation,
  ConversationContent,
} from "@/components/ai-elements/conversation";
import { JumpToLatestPill } from "./jump-to-latest-pill";
import { MessageResponse } from "@/components/ai-elements/message";
import { ChatErrorAlert } from "./chat-error-alert";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { MessageActions } from "./message-actions";
import { PaperCitation } from "./paper-citation";
import { PapersContext, type PapersContextValue } from "./papers-context";
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

export type ResolvedPaper = ResolvablePaper;

/**
 * Our `listThreadMessages` query enriches each UIMessage with an
 * `error` string (a serialized ChatErrorEnvelope) — @convex-dev/agent's
 * own UIMessage type strips that field, so we widen it here.
 */
type ChatUIMessage = UIMessage & { error?: string };

/**
 * Parse `[Pn]` / `[Pn, Pm, …]` tokens in a string and emit text chunks
 * interleaved with <PaperCitation> pills. The pill itself reads its
 * paper from PapersContext — this function has no paper data at all,
 * which is what lets citation state stay live across Streamdown's
 * aggressive internal memoization (memoized JSX reuses the cached
 * <PaperCitation> element, but context consumers always re-render on
 * value change).
 */
function splitTextForChips(text: string): React.ReactNode[] {
  const groups = resolvePaperReferences<ResolvedPaper>(text, []);
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

/**
 * Recursively rewrite every string in a React node tree so that any
 * `[Pn]` / `[Pn, Pm, …]` citation tokens become <PaperCitation> chips.
 * Non-string nodes (elements, fragments) are walked through but
 * otherwise preserved, so citations inside list items, headings,
 * table cells, blockquotes, and inline emphasis all get resolved.
 * Without this, only text directly inside <p> becomes interactive —
 * which is why production messages with citations inside markdown
 * bullets render as plain text.
 */
function renderWithCitations(node: ReactNode): ReactNode {
  if (node == null || typeof node === "boolean") return node;
  if (typeof node === "string") {
    return splitTextForChips(node);
  }
  if (typeof node === "number") return node;
  if (Array.isArray(node)) {
    return node.map((child, i) => (
      <Fragment key={i}>{renderWithCitations(child)}</Fragment>
    ));
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    const { children } = node.props;
    if (children == null) return node;
    return cloneElement(node, undefined, renderWithCitations(children));
  }
  return node;
}

/**
 * Tag names the Streamdown markdown renderer emits that can contain
 * user-visible text. Each of these gets a citation-aware override.
 * `code` / `pre` are intentionally excluded — we don't want to rewrite
 * tokens inside fenced code blocks.
 */
const CITATION_TAGS = [
  "p",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "td",
  "th",
  "strong",
  "em",
  "del",
  "span",
] as const;

/**
 * Build the Streamdown tag → component map. Pure: no closure over
 * papers or jobId — pill data comes from PapersContext at render time.
 * Exported for tests; the runtime uses the module-level constant
 * `STREAMDOWN_COMPONENTS` below so every <Streamdown> call shares the
 * same `components` reference and the library's internal Block memo
 * stays stable.
 */
export function buildStreamdownComponents() {
  const components: Record<
    string,
    (props: { children?: ReactNode }) => ReactNode
  > = {};
  for (const tag of CITATION_TAGS) {
    components[tag] = (props: { children?: ReactNode }) => {
      const rendered = Children.toArray(props.children).map((child, i) => (
        <Fragment key={i}>{renderWithCitations(child)}</Fragment>
      ));
      return createElement(tag, null, rendered);
    };
  }
  return components;
}

const STREAMDOWN_COMPONENTS = buildStreamdownComponents();

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
  message: ChatUIMessage;
  isLastAssistant: boolean;
  isFirstInGroup: boolean;
  threadId: string;
  chatModelId: Id<"models"> | null;
  onRetry: () => void;
  reduceMotion: boolean;
}

const MessageRow = memo(function MessageRow({
  message,
  isLastAssistant,
  isFirstInGroup,
  threadId,
  chatModelId,
  onRetry,
  reduceMotion,
}: MessageRowProps) {
  const text = getMessageText(message);
  const isStreaming = message.status === "streaming";
  const isFailed = message.status === "failed";
  const isEmpty = text.length === 0;
  const isUser = message.role === "user";

  const rawError = message.error;

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
            <MessageResponse components={STREAMDOWN_COMPONENTS}>
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

      {isFailed && rawError ? (
        <ChatErrorAlert
          rawError={rawError}
          onRetry={onRetry}
          chatModelId={chatModelId}
        />
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

  const chatSources = useQuery(
    api.chat.chatPapers.listChatSourcesWithInclusion,
    { jobId },
  );

  const papersContextValue = useMemo<PapersContextValue>(() => {
    const papersByPosition = new Map<number, ResolvablePaper>();
    if (chatSources) {
      for (const row of chatSources) {
        papersByPosition.set(row.position, {
          sourceId: row.sourceId,
          chatPaperId: row.chatPaperId,
          position: row.position,
          title: row.title,
          authors: row.authors,
          year: row.year,
          abstract: row.abstract,
          openalexId: row.openalexId,
          doi: row.doi,
          pdfUrl: row.pdfUrl,
          included: row.included,
        });
      }
    }
    return { papersByPosition, jobId };
  }, [chatSources, jobId]);

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
    <PapersContext.Provider value={papersContextValue}>
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
                      message={message as ChatUIMessage}
                      isLastAssistant={message.id === lastAssistantId}
                      isFirstInGroup={isFirstInGroup}
                      threadId={threadId}
                      chatModelId={chatModelId}
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
    </PapersContext.Provider>
  );
}
