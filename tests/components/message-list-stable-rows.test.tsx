/**
 * @vitest-environment jsdom
 *
 * A streamed assistant message has id `stream:<streamId>` and `step-start`
 * parts; once saved it comes back with its database id, the same agent
 * `key`, and no `step-start` parts. The row and its answer text must keep
 * their DOM nodes through that swap, or the answer remounts and flashes.
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MessageList } from "@/components/extraction/chat/message-list";

const user = {
  id: "u_1",
  key: "thread_1-0-0",
  role: "user",
  status: "success",
  parts: [{ type: "text", text: "Question" }],
  order: 0,
  stepOrder: 0,
  _creationTime: 0,
};
const streaming = {
  id: "stream:s_1",
  key: "thread_1-0-1",
  role: "assistant",
  status: "streaming",
  parts: [
    { type: "step-start" },
    { type: "text", text: "Partial answer", state: "streaming" },
  ],
  order: 0,
  stepOrder: 1,
  _creationTime: 1,
};
const saved = {
  ...streaming,
  id: "m_saved",
  status: "success",
  parts: [{ type: "text", text: "Partial answer, finished.", state: "done" }],
};

let results: unknown[] = [user, streaming];

vi.mock("@convex-dev/agent/react", () => ({
  useUIMessages: () => ({ results, status: "Loaded" }),
}));

vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useQuery: () => undefined,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    chat: {
      messages: {
        listThreadMessages: "listThreadMessages",
        getChatWebSearchPricing: "getChatWebSearchPricing",
        regenerateLastAssistant: "regenerateLastAssistant",
      },
      sourceEvents: { listForThread: "listForThread" },
    },
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/ai-elements/conversation", () => ({
  Conversation: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ConversationContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ConversationScrollButton: () => null,
}));

vi.mock("@/components/extraction/chat/message-actions", () => ({
  MessageActions: () => null,
}));

describe("<MessageList> row identity", () => {
  it("keeps the assistant row and its text mounted when its streamed message is saved", () => {
    const props = {
      threadId: "thread_1",
      chatModelId: null,
      chatModels: [],
      isJobGenerating: true,
    };
    const { container, rerender } = render(<MessageList {...props} />);
    const streamingRow = container.querySelector('[data-role="assistant"]');
    expect(streamingRow).toHaveAttribute("data-message-id", "stream:s_1");
    const streamingText = streamingRow!.querySelector("p");
    expect(streamingText).toHaveTextContent("Partial answer");

    results = [user, saved];
    rerender(<MessageList {...props} isJobGenerating={false} />);

    const savedRow = container.querySelector('[data-role="assistant"]');
    expect(savedRow).toHaveAttribute("data-message-id", "m_saved");
    expect(savedRow).toBe(streamingRow);
    const savedText = savedRow!.querySelector("p");
    expect(savedText).toHaveTextContent("Partial answer, finished.");
    expect(savedText).toBe(streamingText);
  });
});
