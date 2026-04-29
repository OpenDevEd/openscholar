/**
 * @vitest-environment jsdom
 *
 * U5 — MessageRow iterates UIMessage.parts and renders the AI SDK v6
 * discriminated union: text via MessageResponse, tool-* via ToolStep,
 * step-start via StepBoundary, source-url accumulated into the footer
 * via WebSourceChips. Tests target data-* / role contracts only.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { UIMessage } from "@convex-dev/agent/react";
import type { ToolUIPart, UIMessagePart } from "ai";
import { MessageRow } from "@/components/extraction/chat/message-list";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useQuery: () => [],
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    chat: {
      messages: { regenerateLastAssistant: "regenerateLastAssistant" },
      model: { listChatModels: "listChatModels" },
    },
  },
}));

vi.mock("@/components/extraction/chat/message-actions", () => ({
  MessageActions: () => null,
}));

vi.mock("@/components/extraction/chat/chat-error-alert", () => ({
  ChatErrorAlert: () => null,
}));

vi.mock("@/components/extraction/chat/paper-citation", () => ({
  PaperCitation: ({ index }: { index: number }) => (
    <a href={`#paper-${index}`}>{index}</a>
  ),
}));

type AnyPart = UIMessagePart<Record<string, never>, Record<string, never>>;
type ChatUIMessage = UIMessage & { error?: string; aborted?: boolean };

function makeAssistant(parts: AnyPart[], over: Partial<ChatUIMessage> = {}) {
  return {
    id: "m_1",
    role: "assistant",
    status: "success",
    key: "m_1",
    order: 0,
    stepOrder: 0,
    _creationTime: 0,
    text: "",
    parts,
    ...over,
  } as ChatUIMessage;
}

function renderRow(msg: ChatUIMessage) {
  return render(
    <MessageRow
      message={msg}
      isLastAssistant
      isFirstInGroup
      chatModelId={null}
      chatModels={[]}
      onRetry={() => {}}
      reduceMotion
      isJobGenerating={false}
    />,
  );
}

const textPart = (text: string): AnyPart => ({ type: "text", text });
const stepStart: AnyPart = { type: "step-start" };
const toolPart = (state: ToolUIPart["state"], extra: object = {}): AnyPart =>
  ({
    type: "tool-web_search",
    toolCallId: "c1",
    state,
    ...extra,
  }) as unknown as AnyPart;
const sourceUrlPart = (url: string, sourceId: string): AnyPart => ({
  type: "source-url",
  sourceId,
  url,
});

describe("<MessageRow> parts iteration — text-only", () => {
  it("renders a single text part as the entire assistant content with no tool step or footer chips", () => {
    renderRow(
      makeAssistant([textPart("Just a normal answer.")], {
        text: "Just a normal answer.",
      }),
    );
    expect(screen.getByText(/just a normal answer/i)).toBeInTheDocument();
    expect(screen.queryByTestId("tool-step")).toBeNull();
    expect(
      document.querySelector("[data-web-sources-count]"),
    ).toBeNull();
    expect(
      document.querySelector("[data-step-boundary]"),
    ).toBeNull();
  });
});

describe("<MessageRow> parts iteration — text + tool (mid-stream)", () => {
  it("renders the in-flight ToolStep and the prior text without a step boundary or footer chips", () => {
    renderRow(
      makeAssistant(
        [
          textPart("Let me check the literature."),
          stepStart,
          toolPart("input-streaming", { input: { query: "RNA editing" } }),
        ],
        { status: "streaming" },
      ),
    );

    expect(screen.getByText(/let me check the literature/i)).toBeInTheDocument();

    const tool = screen.getByTestId("tool-step");
    expect(tool).toHaveAttribute("data-tool-state", "input-streaming");
    expect(tool).toHaveAttribute("data-tool-name", "web_search");

    // step-start sits between text and an in-flight tool — boundary is
    // visible only between *completed* tool and following text.
    expect(document.querySelector("[data-step-boundary]")).toBeNull();
    expect(document.querySelector("[data-web-sources-count]")).toBeNull();
  });
});
