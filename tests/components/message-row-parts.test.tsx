/**
 * @vitest-environment jsdom
 *
 * U5 — MessageRow iterates UIMessage.parts: text via MessageResponse,
 * source-url accumulated into the footer via Sources. Tests target
 * data-* / role contracts only.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithTooltip as render } from "../helpers/render-with-tooltip";
import type { UIMessage } from "@convex-dev/agent/react";
import type { UIMessagePart } from "ai";
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
      isJobGenerating={false}
    />,
  );
}

const textPart = (text: string): AnyPart => ({ type: "text", text });
const sourceUrlPart = (url: string, sourceId: string): AnyPart => ({
  type: "source-url",
  sourceId,
  url,
});

/** Opens the footer sources and returns their link targets. */
function sourceLinks() {
  const sources = document.querySelector(
    "[data-web-sources-count]",
  ) as HTMLElement | null;
  expect(sources).not.toBeNull();
  fireEvent.click(within(sources!).getByRole("button"));
  return within(sources!)
    .getAllByRole("link")
    .map((link) => link.getAttribute("href"));
}

describe("<MessageRow> parts iteration — text-only", () => {
  it("renders a single text part as the entire assistant content with no footer sources", () => {
    renderRow(
      makeAssistant([textPart("Just a normal answer.")], {
        text: "Just a normal answer.",
      }),
    );
    expect(screen.getByText(/just a normal answer/i)).toBeInTheDocument();
    expect(document.querySelector("[data-web-sources-count]")).toBeNull();
  });
});

describe("<MessageRow> parts iteration — text + source-url", () => {
  it("renders the text with the web sources collected at the message footer", () => {
    renderRow(
      makeAssistant([
        sourceUrlPart("https://arxiv.org/abs/X", "s1"),
        sourceUrlPart("https://example.com/foo", "s2"),
        textPart("Based on the search, here is the answer."),
      ]),
    );

    expect(
      screen.getByText(/based on the search, here is the answer/i),
    ).toBeInTheDocument();
    expect(sourceLinks()).toEqual([
      "https://arxiv.org/abs/X",
      "https://example.com/foo",
    ]);
  });

  it("lists a page once when several searches return it", () => {
    renderRow(
      makeAssistant([
        sourceUrlPart("https://arxiv.org/abs/X", "s1"),
        sourceUrlPart("https://arxiv.org/abs/X", "s2"),
        textPart("Answer."),
      ]),
    );

    expect(sourceLinks()).toEqual(["https://arxiv.org/abs/X"]);
  });
});
