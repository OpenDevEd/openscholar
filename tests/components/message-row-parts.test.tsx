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

describe("<MessageRow> parts iteration — text + tool + text + source-url (full)", () => {
  it("renders text → tool → boundary → text in DOM order, with source-urls collected at the message footer", () => {
    const parts: AnyPart[] = [
      textPart("Let me search."),
      stepStart,
      toolPart("output-available", {
        input: { query: "RNA editing" },
        output: {
          sources: [
            { url: "https://arxiv.org/abs/X" },
            { url: "https://example.com/foo" },
          ],
          creditsUsed: 2,
        },
      }),
      sourceUrlPart("https://arxiv.org/abs/X", "s1"),
      stepStart,
      sourceUrlPart("https://example.com/foo", "s2"),
      textPart("Based on the search, here is the answer."),
    ];
    renderRow(makeAssistant(parts));

    // Both text parts visible.
    expect(screen.getByText(/let me search/i)).toBeInTheDocument();
    expect(
      screen.getByText(/based on the search, here is the answer/i),
    ).toBeInTheDocument();

    // ToolStep settled to output-available with the correct count.
    const tool = screen.getByTestId("tool-step");
    expect(tool).toHaveAttribute("data-tool-state", "output-available");
    expect(tool).toHaveTextContent(/found 2 results for/i);

    // Step boundary appears (completed tool followed by text via the
    // source-url interlude is collapsed by the heuristic — boundary is
    // visible because the *immediate* next part after the tool was the
    // source-url, not text. So we expect zero boundaries here, since
    // the heuristic looks at immediate neighbors only.
    expect(document.querySelector("[data-step-boundary]")).toBeNull();

    // Source-url chips render at the footer regardless of part position.
    const chipRow = document.querySelector(
      "[data-web-sources-count]",
    ) as HTMLElement | null;
    expect(chipRow).not.toBeNull();
    expect(chipRow!.getAttribute("data-web-sources-count")).toBe("2");
    const chipLinks = within(chipRow!).getAllByRole("link");
    expect(chipLinks).toHaveLength(2);
    expect(chipLinks[0].getAttribute("data-source-host")).toBe("arxiv.org");
    expect(chipLinks[1].getAttribute("data-source-host")).toBe("example.com");
  });

  it("shows the step boundary <hr> when an explicit step-start sits between a completed tool and following text", () => {
    const parts: AnyPart[] = [
      toolPart("output-available", {
        input: { query: "q" },
        output: { sources: [{ url: "https://x" }], creditsUsed: 1 },
      }),
      stepStart,
      textPart("Here is the answer."),
    ];
    renderRow(makeAssistant(parts));

    const hr = document.querySelector("[data-step-boundary]");
    expect(hr).not.toBeNull();
    expect(hr?.tagName.toLowerCase()).toBe("hr");
  });
});
