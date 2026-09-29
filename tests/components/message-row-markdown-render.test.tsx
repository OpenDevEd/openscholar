/**
 * @vitest-environment jsdom
 *
 * Regression coverage for the actual chat row render path:
 * MessageRow -> getChatMessageText -> normalizeChatMarkdownForRender
 * -> MessageResponse/Streamdown -> chat markdown components.
 */
import { render, screen } from "@testing-library/react";
import { renderWithTooltip } from "../helpers/render-with-tooltip";
import type { UIMessage } from "@convex-dev/agent/react";
import { describe, expect, it, vi } from "vitest";
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

function makeAssistantMessage(text: string): UIMessage {
  return {
    id: "ks7dkbjy0g8652d46aks22pn4985h1z3",
    key: "ks7dkbjy0g8652d46aks22pn4985h1z3",
    role: "assistant",
    status: "success",
    order: 27,
    stepOrder: 0,
    _creationTime: 0,
    parts: [{ type: "text", text }],
    text,
  } as UIMessage;
}

describe("<MessageRow> markdown rendering", () => {
  it("does not leak persisted Gemini tag escapes or standalone thematic-break markers", () => {
    const text =
      "**Title:** *The UCON<sub\\>ABC</sub\\> usage control model* [P37]\n\n" +
      "Authorizations refer to traditional rights based on subject/object attributes.\n\n" +
      "***\n\n" +
      "**We are really covering ground now.**";

    const { container } = render(
      <MessageRow
        message={makeAssistantMessage(text)}
        isLastAssistant
        isFirstInGroup
        chatModelId={null}
        chatModels={[]}
        onRetry={() => {}}
        isJobGenerating={false}
      />,
    );

    expect(container.textContent).not.toContain("<sub");
    expect(container.textContent).not.toContain("</sub");
    expect(container.textContent).not.toContain("***");
    expect(container.textContent).not.toContain("*");
    expect(container.querySelector("sub")).toHaveTextContent("ABC");
    expect(container.querySelector("hr")).toHaveAttribute(
      "data-chat-markdown",
      "thematic-break",
    );
    expect(screen.getByRole("link", { name: "37" })).toHaveAttribute(
      "href",
      "#paper-37",
    );
  });

  it("keeps inline code inside its sentence and renders fenced code as a block", () => {
    const text =
      "Call `filter` on the list.\n\n```python\nprint(1)\n```";

    const { container } = renderWithTooltip(
      <MessageRow
        message={makeAssistantMessage(text)}
        isLastAssistant
        isFirstInGroup
        chatModelId={null}
        chatModels={[]}
        onRetry={() => {}}
        isJobGenerating={false}
      />,
    );

    const sentence = container.querySelector('[data-chat-markdown="paragraph"]');
    expect(sentence).toHaveTextContent("Call filter on the list.");
    expect(sentence?.querySelector("code")).toHaveTextContent("filter");
    expect(sentence?.querySelector("pre")).toBeNull();
    expect(container.querySelectorAll("pre")).toHaveLength(1);
    expect(container.querySelector("pre")).toHaveTextContent("print(1)");
  });
});
