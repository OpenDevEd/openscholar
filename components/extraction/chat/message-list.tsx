"use client";

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
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMutation, useQuery } from "convex/react";
import type { TextUIPart, ToolUIPart } from "ai";
import {
  Conversation,
  ConversationContent,
} from "@/components/ai-elements/conversation";
import { JumpToLatestPill } from "./jump-to-latest-pill";
import { MessageResponse } from "@/components/ai-elements/message";
import { StepBoundary } from "@/components/ai-elements/step-boundary";
import { ToolStep } from "@/components/ai-elements/tool-step";
import type { WebSearchPricing } from "@/lib/pricing";
import { WebSourceChips } from "@/components/ai-elements/web-source-chips";
import { AbortedPill } from "./aborted-pill";
import { ChatErrorAlert } from "./chat-error-alert";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { MessageActions } from "./message-actions";
import { PaperCitation } from "./paper-citation";
import { DeprecatedPaperCitationsProvider } from "./paper-citation-context";
import { SuggestionChips } from "./suggestion-chips";
import { StreamingCursor } from "./streaming-cursor";
import { TypingDots } from "./typing-dots";
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
      "mt-3 mb-1.5 text-xs font-semibold uppercase leading-tight tracking-wide text-muted-foreground",
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
    <motion.li
      data-chat-event="sources-updated"
      role="status"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="my-2 flex justify-center"
    >
      <div className="max-w-[90%] rounded-md border border-border/70 bg-muted/45 px-3 py-1.5 text-center text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{title}</span>
        <span className="ml-1">{description}</span>
      </div>
    </motion.li>
  );
}

interface MessageRowProps {
  message: ChatUIMessage;
  isLastAssistant: boolean;
  isFirstInGroup: boolean;
  chatModelId: Id<"models"> | null;
  chatModels: ChatModelRow[];
  onRetry: () => void;
  reduceMotion: boolean;
  isJobGenerating?: boolean;
  /** Resolved web-search source for this thread (from
   *  `getChatWebSearchPricing`). Forwarded to each `<ToolStep>` so the
   *  in-flight chip can render the real credit estimate. */
  webSearchSource?: WebSearchPricing["source"];
  /** Native model web-search USD price, populated only when
   *  `webSearchSource === "openrouter-native"`. */
  modelWebSearchPriceUsd?: number | null;
  paperCitationsDeprecated?: boolean;
}

/**
 * Render a single AI SDK `text` UIMessagePart through Streamdown with the
 * chat-specific component map (citation rewrites, scholarly inline tags,
 * thematic-break tightening). Per-part `state` (streaming/done) wins over
 * the message-level signal — so a finalized text part inside a still-
 * streaming assistant turn renders without `parseIncompleteMarkdown`,
 * avoiding spurious markdown re-parsing once the model has handed off
 * to the next step (tool call, follow-up text part, etc.).
 */
function AssistantTextPart({
  part,
  parseIncompleteMarkdown: outerParseIncomplete,
  paperCitationsDeprecated = false,
}: {
  part: TextUIPart;
  parseIncompleteMarkdown: boolean;
  paperCitationsDeprecated?: boolean;
}) {
  const partStreaming = part.state === "streaming";
  const partDone = part.state === "done";
  const parseIncompleteMarkdown =
    partStreaming || (!partDone && outerParseIncomplete);
  const renderText = normalizeChatMarkdownForRender(part.text);
  return (
    <DeprecatedPaperCitationsProvider deprecated={paperCitationsDeprecated}>
      <MessageResponse
        allowedTags={CHAT_MARKDOWN_ALLOWED_TAGS}
        components={STREAMDOWN_COMPONENTS}
        mode={parseIncompleteMarkdown ? "streaming" : "static"}
        parseIncompleteMarkdown={parseIncompleteMarkdown}
      >
        {renderText}
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
  reduceMotion,
  isJobGenerating = true,
  webSearchSource,
  modelWebSearchPriceUsd,
  paperCitationsDeprecated = false,
}: MessageRowProps) {
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
  const userText = isUser ? getChatMessageText(normalizedMessage) : "";
  const hasAssistantVisibleContent = useMemo(() => {
    if (!isAssistant) return false;
    return normalizedMessage.parts.some((part) => {
      if (part.type === "text") {
        const t = (part as TextUIPart).text;
        return typeof t === "string" && t.length > 0;
      }
      return part.type.startsWith("tool-");
    });
  }, [isAssistant, normalizedMessage.parts]);
  const isEmpty = isAssistant
    ? !hasAssistantVisibleContent
    : userText.length === 0;
  const parseIncompleteMarkdown = isGenerating || isAborted || isFailed;

  const rawError = normalizedMessage.error;
  const displayError =
    rawError ??
    (isStalePending
      ? MESSAGE_LEFT_PENDING_WITHOUT_JOB
      : isFailed
        ? MESSAGE_FAILED_WITHOUT_ERROR
        : null);

  return (
    <motion.li
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
          <div className="whitespace-pre-wrap break-words">{userText}</div>
        ) : isGenerating && isEmpty ? (
          <TypingDots />
        ) : (
          <div className="min-w-0">
            {normalizedMessage.parts.map((part, idx) => {
              if (part.type === "step-start") {
                return (
                  <StepBoundary
                    key={`step-${idx}`}
                    prevPart={normalizedMessage.parts[idx - 1]}
                    nextPart={normalizedMessage.parts[idx + 1]}
                  />
                );
              }
              if (part.type === "text") {
                return (
                  <AssistantTextPart
                    key={`text-${idx}`}
                    part={part as TextUIPart}
                    parseIncompleteMarkdown={parseIncompleteMarkdown}
                    paperCitationsDeprecated={paperCitationsDeprecated}
                  />
                );
              }
              if (part.type.startsWith("tool-")) {
                return (
                  <ToolStep
                    key={`tool-${idx}`}
                    part={part as ToolUIPart}
                    aborted={isAborted}
                    webSearchSource={webSearchSource}
                    modelWebSearchPriceUsd={modelWebSearchPriceUsd}
                  />
                );
              }
              return null;
            })}
            <WebSourceChips parts={normalizedMessage.parts} />
            {isGenerating && !isEmpty ? <StreamingCursor /> : null}
          </div>
        )}
      </div>

      {!isUser && (!isEmpty || isAborted) ? (
        <div className="mt-1 flex items-center gap-2">
          {isAborted ? <AbortedPill /> : null}
          {!isEmpty || isAborted ? (
            <MessageActions
              message={normalizedMessage}
              isLastAssistant={isLastAssistant}
              chatModelId={chatModelId}
              models={chatModels}
              onRetry={onRetry}
            />
          ) : null}
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
    </motion.li>
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
  // Resolves the active web-search path + per-call price server-side
  // so each in-flight `<ToolStep>` chip can render the real credit
  // estimate. Convex deduplicates this against the toggle's own
  // subscription on the same query — a single round trip serves both.
  const webSearchPricing = useQuery(
    api.chat.messages.getChatWebSearchPricing,
    { threadId },
  );
  const webSearchSource = webSearchPricing?.source;
  // The model's native USD price equals usdPerCall ONLY on the
  // openrouter-native branch; pass it through as `null` on every
  // other source so ToolStep doesn't mistake the server-tool flat
  // rate for a native model price.
  const modelWebSearchPriceUsd =
    webSearchPricing?.source === "openrouter-native"
      ? webSearchPricing.usdPerCall
      : null;
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
            {renderResults.map((message, i) => {
              const prev = renderResults[i - 1];
              const showSourceUpdateDividerBefore =
                shouldRenderSourceUpdateDividerBeforeMessage({
                  previous: prev,
                  message,
                  boundary: sourceUpdateBoundary,
                });
              const paperCitationsDeprecated = isAssistantCitationDeprecated(
                message,
                sourceUpdateBoundary,
              );
              const isFirstInGroup = !prev || prev.role !== message.role;
              return (
                <Fragment key={message.id}>
                  {showSourceUpdateDividerBefore && latestSourceEvent ? (
                    <SourceUpdateDivider
                      key={latestSourceEvent._id}
                      title={t("chatSourcesUpdatedDivider")}
                      description={t("chatSourcesUpdatedDividerDescription")}
                    />
                  ) : null}
                  <MessageRow
                    message={message as ChatUIMessage}
                    isLastAssistant={message.id === lastAssistantId}
                    isFirstInGroup={isFirstInGroup}
                    chatModelId={chatModelId}
                    chatModels={chatModels}
                    onRetry={handleRetry}
                    reduceMotion={reduceMotion}
                    isJobGenerating={isJobGenerating}
                    webSearchSource={webSearchSource}
                    modelWebSearchPriceUsd={modelWebSearchPriceUsd}
                    paperCitationsDeprecated={paperCitationsDeprecated}
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
                key={`${latestSourceEvent._id}:after`}
                title={t("chatSourcesUpdatedDivider")}
                description={t("chatSourcesUpdatedDividerDescription")}
              />
            ) : null}
          </AnimatePresence>
        </ol>
      </ConversationContent>
      <JumpToLatestPill messageCount={renderResults.length} />
    </Conversation>
  );
}
