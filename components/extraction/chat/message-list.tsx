"use client";

import { LogoMark } from "@/components/logo";
import {
  Children,
  Fragment,
  cloneElement,
  createElement,
  isValidElement,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { useUIMessages, type UIMessage } from "@convex-dev/agent/react";
import { motion, useReducedMotion } from "motion/react";
import { useMutation, useQuery } from "convex/react";
import type { ReasoningUIPart, SourceUrlUIPart, TextUIPart } from "ai";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "@/components/ai-elements/sources";
import { CHAT_LINK_SAFETY } from "./link-safety-dialog";
import { ChatCodeBlock, ChatTable } from "./chat-markdown-blocks";
import { AbortedPill } from "./aborted-pill";
import { ChatErrorAlert } from "./chat-error-alert";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { MessageActions } from "./message-actions";
import { PaperCitation } from "./paper-citation";
import { DeprecatedPaperCitationsProvider } from "./paper-citation-context";
import { SuggestionChips } from "./suggestion-chips";
import type { ChatModelRow } from "./chat-model-types";
import {
  resolvePaperReferences,
  type ResolvablePaper,
} from "@/lib/chat/resolve-paper";
import { normalizeChatUIMessage } from "@/lib/chat/message-state";
import { getChatMessageText } from "@/lib/chat/message-text";
import { normalizeChatMarkdownForRender } from "@/lib/chat/markdown-render";
import {
  getLatestAssistantForRegenerate,
  hasServerRegenerateReplacement,
  isChatGenerationActive,
  mergeLocalRegenerateMessage,
  type LocalRegenerateState,
} from "@/lib/chat/regenerate-ui-state";
import {
  classifyChatError,
  serializeChatError,
  type ChatErrorClass,
} from "@/lib/errors/taxonomy";
import {
  isAssistantCitationDeprecated,
  shouldRenderSourceUpdateDividerAfterMessages,
  shouldRenderSourceUpdateDividerBeforeMessage,
} from "@/lib/chat/source-update-timeline";
import { cn } from "@/lib/utils";

interface MessageListProps {
  threadId: string;
  chatModelId: Id<"models"> | null;
  chatModels: ChatModelRow[];
  isJobGenerating?: boolean;
  jobError?: MessageListJobError | null;
  onGenerationActivityChange?: (
    active: boolean,
    generationAttemptId?: string,
  ) => void;
}

export type ResolvedPaper = ResolvablePaper;
type MessageListJobError = {
  code: ChatErrorClass;
  message: string;
  httpStatus?: number;
  retryAfterMs?: number;
  providerName?: string;
  at?: number;
};

function serializeMessageListJobError(error: MessageListJobError): string {
  return serializeChatError({
    version: 1,
    class: error.code,
    message: error.message,
    ...(error.httpStatus !== undefined ? { httpStatus: error.httpStatus } : {}),
    ...(error.retryAfterMs !== undefined
      ? { retryAfterMs: error.retryAfterMs }
      : {}),
    ...(error.providerName !== undefined
      ? { providerName: error.providerName }
      : {}),
  });
}

function messageListJobErrorKey(error: MessageListJobError | null): string | null {
  if (!error) return null;
  return JSON.stringify({
    code: error.code,
    message: error.message,
    httpStatus: error.httpStatus ?? null,
    retryAfterMs: error.retryAfterMs ?? null,
    providerName: error.providerName ?? null,
    at: error.at ?? null,
  });
}

/**
 * Our chat read model widens the agent UIMessage with app-level
 * `error` / `aborted` discriminators.
 * `aborted: true` can come from either:
 * 1. a persisted assistant message carrying the abort sentinel, or
 * 2. a stream-backed assistant row whose underlying stream status is
 *    already `aborted`.
 */
type ChatUIMessage = UIMessage & {
  error?: string;
  aborted?: boolean;
  model?: string;
  provider?: string;
};

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
  "hr",
  "ol",
  "ul",
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
  "sub",
  "sup",
] as const;

const CHAT_MARKDOWN_STYLES: Record<
  (typeof CITATION_TAGS)[number],
  { className?: string; marker: string }
> = {
  p: {
    className: "my-3 first:mt-0 last:mb-0 leading-relaxed",
    marker: "paragraph",
  },
  hr: {
    className: "my-5 border-border",
    marker: "thematic-break",
  },
  ol: {
    className: "my-3 list-decimal space-y-2 pl-6",
    marker: "ordered-list",
  },
  ul: {
    className: "my-3 list-disc space-y-2 pl-6",
    marker: "unordered-list",
  },
  li: {
    className: "pl-1 marker:text-muted-foreground",
    marker: "list-item",
  },
  h1: {
    className: "mt-5 mb-2 text-lg font-semibold leading-tight text-foreground",
    marker: "heading",
  },
  h2: {
    className: "mt-5 mb-2 text-base font-semibold leading-tight text-foreground",
    marker: "heading",
  },
  h3: {
    className: "mt-4 mb-2 text-sm font-semibold leading-tight text-foreground",
    marker: "heading",
  },
  h4: {
    className: "mt-4 mb-2 text-sm font-semibold leading-tight text-foreground",
    marker: "heading",
  },
  h5: {
    className: "mt-3 mb-1.5 text-sm font-semibold leading-tight text-foreground",
    marker: "heading",
  },
  h6: {
    className:
      "mt-3 mb-1.5 text-sm font-semibold leading-tight text-muted-foreground",
    marker: "heading",
  },
  blockquote: {
    className: "my-3 border-l-2 border-border pl-4 text-muted-foreground",
    marker: "blockquote",
  },
  td: {
    className: "px-3 py-2 align-top",
    marker: "table-cell",
  },
  th: {
    className: "px-3 py-2 text-left align-top font-semibold text-foreground",
    marker: "table-header",
  },
  strong: {
    className: "font-semibold text-foreground",
    marker: "strong",
  },
  em: {
    className: "italic",
    marker: "emphasis",
  },
  del: {
    className: "line-through",
    marker: "deleted",
  },
  span: {
    marker: "span",
  },
  sub: {
    className: "align-sub text-[0.75em] leading-none",
    marker: "subscript",
  },
  sup: {
    className: "align-super text-[0.75em] leading-none",
    marker: "superscript",
  },
};

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
      const style = CHAT_MARKDOWN_STYLES[tag];
      const componentProps = {
        className: style.className,
        "data-chat-markdown": style.marker,
      };
      if (tag === "hr") {
        return createElement(tag, componentProps);
      }
      const rendered = Children.toArray(props.children).map((child, i) => (
        <Fragment key={i}>{renderWithCitations(child)}</Fragment>
      ));
      return createElement(tag, componentProps, rendered);
    };
  }
  components.table = ChatTable;
  components.code = ChatCodeBlock;
  return components;
}

const STREAMDOWN_COMPONENTS = buildStreamdownComponents();
export const CHAT_MARKDOWN_ALLOWED_TAGS = {
  sub: [],
  sup: [],
};
const LOCAL_REGENERATE_FAILED_ERROR = serializeChatError({
  version: 1,
  class: "regenerate_failed",
  message:
    "Regenerate did not start because the latest chat turn has no assistant message or stream artifact to replace.",
});
const MESSAGE_FAILED_WITHOUT_ERROR = serializeChatError({
  version: 1,
  class: "unknown",
  message: "Assistant message failed without an error payload.",
});
const MESSAGE_LEFT_PENDING_WITHOUT_JOB = serializeChatError({
  version: 1,
  class: "unknown",
  message:
    "Assistant response was left pending after the backend generation lock ended. No provider error was recorded for this message.",
});

function markLocalRegenerateFailed(
  state: LocalRegenerateState,
  error: string,
): LocalRegenerateState {
  return {
    ...state,
    backendStarted: false,
    generationAttemptId: undefined,
    status: "failed",
    error,
  };
}

function SourceUpdateDivider({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div
      data-chat-event="sources-updated"
      role="status"
      className="flex justify-center"
    >
      <div className="max-w-[90%] rounded-md border border-border bg-inset px-3 py-1.5 text-center text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{title}</span>
        <span className="ml-1">{description}</span>
      </div>
    </div>
  );
}

/**
 * React keys for a message's parts. A streamed message carries
 * `step-start` parts that its saved copy drops, so index keys would
 * remount every part the moment the message is saved.
 */
function partRenderKeys(parts: UIMessage["parts"]): string[] {
  const seen = new Map<string, number>();
  return parts.map((part) => {
    if ("toolCallId" in part) return part.toolCallId;
    const n = seen.get(part.type) ?? 0;
    seen.set(part.type, n + 1);
    return `${part.type}-${n}`;
  });
}

function WebSources({ parts }: { parts: UIMessage["parts"] }) {
  // Two searches in one reply can return the same page.
  const sources = [
    ...new Map(
      parts
        .filter((part): part is SourceUrlUIPart => part.type === "source-url")
        .map((source) => [source.url, source]),
    ).values(),
  ];
  if (sources.length === 0) return null;
  return (
    <Sources className="mb-0" data-web-sources-count={sources.length}>
      <SourcesTrigger count={sources.length} />
      <SourcesContent>
        {sources.map((source) => (
          <Source
            key={source.sourceId}
            href={source.url}
            title={source.title || source.url}
          />
        ))}
      </SourcesContent>
    </Sources>
  );
}

interface MessageRowProps {
  message: ChatUIMessage;
  isLastAssistant: boolean;
  isFirstInGroup: boolean;
  chatModelId: Id<"models"> | null;
  chatModels: ChatModelRow[];
  onRetry: () => void;
  isJobGenerating?: boolean;
  paperCitationsDeprecated?: boolean;
}

/**
 * Render a single AI SDK `text` UIMessagePart through Streamdown with the
 * chat-specific component map (citation rewrites, scholarly inline tags,
 * thematic-break tightening). Streamdown stays in its default streaming
 * mode for the part's whole life: its static mode renders a different
 * tree, so switching when the part finishes remounts the whole answer.
 * Only unfinished text gets its dangling markdown closed; running that
 * repair on finished text can append stray markers.
 */
function AssistantTextPart({
  part,
  isAnimating,
  isUnfinished,
  paperCitationsDeprecated = false,
}: {
  part: TextUIPart;
  isAnimating: boolean;
  isUnfinished: boolean;
  paperCitationsDeprecated?: boolean;
}) {
  return (
    <DeprecatedPaperCitationsProvider deprecated={paperCitationsDeprecated}>
      <MessageResponse
        allowedTags={CHAT_MARKDOWN_ALLOWED_TAGS}
        components={STREAMDOWN_COMPONENTS}
        isAnimating={isAnimating}
        parseIncompleteMarkdown={isUnfinished}
        linkSafety={CHAT_LINK_SAFETY}
      >
        {normalizeChatMarkdownForRender(part.text)}
      </MessageResponse>
    </DeprecatedPaperCitationsProvider>
  );
}

export const MessageRow = memo(function MessageRow({
  message,
  isLastAssistant,
  isFirstInGroup,
  chatModelId,
  chatModels,
  onRetry,
  isJobGenerating = true,
  paperCitationsDeprecated = false,
}: MessageRowProps) {
  const t = useTranslations("extraction");
  const normalizedMessage = normalizeChatUIMessage(message);
  const isStreamingStatus = normalizedMessage.status === "streaming";
  const isPendingStatus = normalizedMessage.status === "pending";
  const isAborted = normalizedMessage.aborted === true;
  const isUser = normalizedMessage.role === "user";
  const isAssistant = normalizedMessage.role === "assistant";
  const isLocalRegenerate = normalizedMessage.id.startsWith("local-regenerate:");
  const isStalePending =
    isAssistant &&
    !isJobGenerating &&
    !isLocalRegenerate &&
    !isAborted &&
    (isStreamingStatus || isPendingStatus);
  const isGenerating =
    isAssistant && (isStreamingStatus || isPendingStatus) && !isStalePending;
  // Aborted messages surface to the client as status:"failed" (the library
  // maps stream aborted → "failed" internally — see
  // node_modules/@convex-dev/agent/src/deltas.ts statusFromStreamStatus).
  // The `aborted` flag discriminates: real failure vs. user stop.
  const isFailed =
    isAssistant &&
    (normalizedMessage.status === "failed" || isStalePending) &&
    !isAborted;
  const partKeys = partRenderKeys(normalizedMessage.parts);
  const userText = isUser ? getChatMessageText(normalizedMessage) : "";
  const hasAssistantVisibleContent = useMemo(() => {
    if (!isAssistant) return false;
    return normalizedMessage.parts.some((part) => {
      if (part.type === "text" || part.type === "reasoning") {
        return part.text.length > 0;
      }
      return part.type === "source-url";
    });
  }, [isAssistant, normalizedMessage.parts]);
  const isEmpty = isAssistant
    ? !hasAssistantVisibleContent
    : userText.length === 0;

  const rawError = normalizedMessage.error;
  const displayError =
    rawError ??
    (isStalePending
      ? MESSAGE_LEFT_PENDING_WITHOUT_JOB
      : isFailed
        ? MESSAGE_FAILED_WITHOUT_ERROR
        : null);

  return (
    <Message
      from={normalizedMessage.role}
      data-role={normalizedMessage.role}
      data-status={
        isAborted ? "aborted" : isStalePending ? "failed" : normalizedMessage.status
      }
      data-streaming={isGenerating}
      data-error={isFailed}
      data-message-state={isAborted ? "aborted" : undefined}
      data-message-id={normalizedMessage.id}
      data-message-model={normalizedMessage.model}
      data-message-provider={normalizedMessage.provider}
      data-first-in-group={isFirstInGroup ? "true" : undefined}
      aria-busy={isGenerating}
      className={cn(!isUser && "max-w-3xl")}
    >
      {!isUser && isFirstInGroup ? (
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <LogoMark className="size-5" />
          <span>Assistant</span>
        </div>
      ) : null}

      <MessageContent className={cn(!isUser && "w-full")}>
        {isUser ? (
          <div className="whitespace-pre-wrap break-words">{userText}</div>
        ) : isGenerating && isEmpty ? (
          <span role="status">
            <Shimmer>{t("chatThinking")}</Shimmer>
          </span>
        ) : (
          <>
            {normalizedMessage.parts.map((part, idx) => {
              if (part.type === "reasoning") {
                const reasoning = part as ReasoningUIPart;
                if (!reasoning.text) return null;
                return (
                  <Reasoning
                    key={partKeys[idx]}
                    className="mb-0"
                    defaultOpen={false}
                    isStreaming={isGenerating && reasoning.state === "streaming"}
                  >
                    <ReasoningTrigger className="w-fit gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground [&_svg]:size-3" />
                    <ReasoningContent className="pt-1.5 text-xs leading-relaxed text-muted-foreground/70 [&>div]:space-y-2 [&_li>p]:inline">
                      {reasoning.text}
                    </ReasoningContent>
                  </Reasoning>
                );
              }
              if (part.type === "text") {
                const text = part as TextUIPart;
                return (
                  <AssistantTextPart
                    key={partKeys[idx]}
                    part={text}
                    isAnimating={isGenerating && text.state !== "done"}
                    isUnfinished={
                      text.state !== "done" &&
                      (isGenerating || isAborted || isFailed)
                    }
                    paperCitationsDeprecated={paperCitationsDeprecated}
                  />
                );
              }
              return null;
            })}
            <WebSources parts={normalizedMessage.parts} />
          </>
        )}
      </MessageContent>

      {!isUser && (!isEmpty || isAborted) ? (
        <div className="flex items-center gap-2">
          {isAborted ? <AbortedPill /> : null}
          <MessageActions
            message={normalizedMessage}
            isLastAssistant={isLastAssistant}
            chatModelId={chatModelId}
            models={chatModels}
            onRetry={onRetry}
          />
        </div>
      ) : null}

      {isFailed && displayError ? (
        <ChatErrorAlert
          rawError={displayError}
          onRetry={onRetry}
          canRetry={isLastAssistant}
          chatModelId={chatModelId}
          models={chatModels}
        />
      ) : null}
    </Message>
  );
});

export function MessageList({
  threadId,
  chatModelId,
  chatModels,
  isJobGenerating = false,
  jobError = null,
  onGenerationActivityChange,
}: MessageListProps) {
  const t = useTranslations("extraction");
  const reduceMotion = useReducedMotion() ?? false;
  const regenerate = useMutation(api.chat.messages.regenerateLastAssistant);
  const [localRegenerate, setLocalRegenerate] =
    useState<LocalRegenerateState | null>(null);
  const localRegenerateRef = useRef<LocalRegenerateState | null>(null);
  const localRegenerateRequestSeq = useRef(0);

  const { results, status } = useUIMessages(
    api.chat.messages.listThreadMessages,
    { threadId },
    { initialNumItems: 20, stream: true },
  );
  const sourceEvents = useQuery(api.chat.sourceEvents.listForThread, {
    threadId,
  });
  const serverRegenerateReplacementVisible =
    localRegenerate !== null &&
    hasServerRegenerateReplacement(results as ChatUIMessage[], localRegenerate);
  const jobErrorKey = useMemo(() => messageListJobErrorKey(jobError), [jobError]);
  const jobErrorWire = useMemo(() => {
    if (!jobError) return null;
    return serializeMessageListJobError(jobError);
  }, [jobError]);

  useEffect(() => {
    localRegenerateRef.current = localRegenerate;
  }, [localRegenerate]);

  useEffect(() => {
    if (serverRegenerateReplacementVisible) {
      localRegenerateRef.current = null;
      setLocalRegenerate(null);
    }
  }, [serverRegenerateReplacementVisible]);

  useEffect(() => {
    if (!localRegenerate?.backendStarted) return;
    if (serverRegenerateReplacementVisible) return;
    if (isJobGenerating) return;
    if (!jobErrorWire) return;
    if (localRegenerate.startedWithJobErrorKey === jobErrorKey) return;

    setLocalRegenerate((current) => {
      if (current?.requestId !== localRegenerate.requestId) return current;
      const failed = markLocalRegenerateFailed(current, jobErrorWire);
      localRegenerateRef.current = failed;
      return failed;
    });
  }, [
    isJobGenerating,
    jobErrorKey,
    jobErrorWire,
    localRegenerate,
    serverRegenerateReplacementVisible,
  ]);

  const renderResults = useMemo(
    () =>
      mergeLocalRegenerateMessage(
        results as ChatUIMessage[],
        serverRegenerateReplacementVisible ? null : localRegenerate,
      ) as ChatUIMessage[],
    [results, localRegenerate, serverRegenerateReplacementVisible],
  );
  const latestSourceEvent = useMemo(() => {
    if (!sourceEvents || sourceEvents.length === 0) return null;
    return sourceEvents.reduce((latest, event) =>
      event.createdAt > latest.createdAt ? event : latest,
    );
  }, [sourceEvents]);
  const sourceUpdateBoundary = latestSourceEvent
    ? { boundaryOrder: latestSourceEvent.boundaryOrder }
    : null;

  const generationActive = isChatGenerationActive(
    renderResults,
    serverRegenerateReplacementVisible ? null : localRegenerate,
    { isJobGenerating },
  );

  useEffect(() => {
    if (generationActive && localRegenerate?.generationAttemptId) {
      onGenerationActivityChange?.(true, localRegenerate.generationAttemptId);
      return;
    }
    onGenerationActivityChange?.(generationActive);
  }, [
    generationActive,
    localRegenerate?.generationAttemptId,
    onGenerationActivityChange,
  ]);

  const isLoadingFirstPage =
    status === "LoadingFirstPage" && renderResults.length === 0;

  const lastAssistantId = useMemo(
    () => getLatestAssistantForRegenerate(renderResults)?.id ?? null,
    [renderResults],
  );

  const handleRetry = useCallback(() => {
    const latestAssistant = getLatestAssistantForRegenerate(
      results as ChatUIMessage[],
    );
    if (!latestAssistant) {
      const lastMessage = (results as ChatUIMessage[]).at(-1);
      const fallbackState: LocalRegenerateState = markLocalRegenerateFailed(
        {
          replacedAssistantId: `missing:${Date.now()}`,
          replacedAssistantIds: [],
          order: lastMessage?.order ?? 0,
          stepOrder: (lastMessage?.stepOrder ?? -1) + 1,
          requestId: `missing:${Date.now()}:${++localRegenerateRequestSeq.current}`,
          startedAt: Date.now(),
          startedWithJobErrorKey: jobErrorKey,
        },
        LOCAL_REGENERATE_FAILED_ERROR,
      );
      localRegenerateRef.current = fallbackState;
      setLocalRegenerate(fallbackState);
      return;
    }

    const nextState: LocalRegenerateState = {
      replacedAssistantId: latestAssistant.id,
      replacedAssistantIds: (results as ChatUIMessage[])
        .filter(
          (message) =>
            message.role === "assistant" &&
            message.order === latestAssistant.order,
        )
        .map((message) => message.id),
      order: latestAssistant.order,
      stepOrder: latestAssistant.stepOrder,
      requestId: `${latestAssistant.id}:${Date.now()}:${++localRegenerateRequestSeq.current}`,
      startedAt: Date.now(),
      startedWithJobErrorKey: jobErrorKey,
    };
    localRegenerateRef.current = nextState;
    setLocalRegenerate(nextState);

    void Promise.resolve(regenerate({ threadId }))
      .then((result) => {
        if (result?.started !== true) {
          if (localRegenerateRef.current?.requestId === nextState.requestId) {
            const failed = markLocalRegenerateFailed(
              nextState,
              result?.error
                ? serializeMessageListJobError(result.error)
                : (jobErrorWire ?? LOCAL_REGENERATE_FAILED_ERROR),
            );
            localRegenerateRef.current = failed;
            setLocalRegenerate(failed);
          }
          return;
        }
        const current = localRegenerateRef.current;
        if (current?.requestId === nextState.requestId) {
          const backendStartedState = {
            ...current,
            backendStarted: true,
            generationAttemptId: result.generationAttemptId,
          };
          localRegenerateRef.current = backendStartedState;
          setLocalRegenerate(backendStartedState);
        }
      })
      .catch((err) => {
        if (localRegenerateRef.current?.requestId === nextState.requestId) {
          const failed = markLocalRegenerateFailed(
            nextState,
            serializeChatError(classifyChatError(err)),
          );
          localRegenerateRef.current = failed;
          setLocalRegenerate(failed);
        }
        console.error("retry failed", err);
      });
  }, [jobErrorKey, jobErrorWire, regenerate, results, threadId]);

  if (renderResults.length === 0) {
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
        <SuggestionChips threadId={threadId} />
      </div>
    );
  }

  return (
    <Conversation
      // `min-h-0` lets the flex child shrink so the conversation scrolls
      // instead of pushing the composer off-screen. Opening a thread lands
      // on the latest message without animating down to it.
      className="min-h-0 overscroll-contain"
      initial="instant"
      data-message-list="populated"
    >
      <ConversationContent className="mx-auto w-full max-w-3xl gap-4">
        {renderResults.map((message, i) => {
          const prev = renderResults[i - 1];
          const showSourceUpdateDividerBefore =
            shouldRenderSourceUpdateDividerBeforeMessage({
              previous: prev,
              message,
              boundary: sourceUpdateBoundary,
            });
          return (
            // `key` stays the same while a message goes from optimistic or
            // streaming to saved; its `id` changes, which would remount it.
            <Fragment key={message.key}>
              {showSourceUpdateDividerBefore && latestSourceEvent ? (
                <SourceUpdateDivider
                  title={t("chatSourcesUpdatedDivider")}
                  description={t("chatSourcesUpdatedDividerDescription")}
                />
              ) : null}
              <MessageRow
                message={message as ChatUIMessage}
                isLastAssistant={message.id === lastAssistantId}
                isFirstInGroup={!prev || prev.role !== message.role}
                chatModelId={chatModelId}
                chatModels={chatModels}
                onRetry={handleRetry}
                isJobGenerating={isJobGenerating}
                paperCitationsDeprecated={isAssistantCitationDeprecated(
                  message,
                  sourceUpdateBoundary,
                )}
              />
            </Fragment>
          );
        })}
        {latestSourceEvent &&
        shouldRenderSourceUpdateDividerAfterMessages(
          renderResults,
          sourceUpdateBoundary,
        ) ? (
          <SourceUpdateDivider
            title={t("chatSourcesUpdatedDivider")}
            description={t("chatSourcesUpdatedDividerDescription")}
          />
        ) : null}
      </ConversationContent>
      <ConversationScrollButton aria-label={t("chatJumpToLatest")} />
    </Conversation>
  );
}
