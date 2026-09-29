/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessageList } from "@/components/extraction/chat/message-list";
import { useDeprecatedPaperCitations } from "@/components/extraction/chat/paper-citation-context";

const threadMessages = [
  {
    id: "u_old",
    key: "u_old",
    role: "user",
    status: "success",
    parts: [{ type: "text", text: "Question before update" }],
    order: 0,
    stepOrder: 0,
    _creationTime: 0,
  },
  {
    id: "a_old",
    key: "a_old",
    role: "assistant",
    status: "success",
    parts: [{ type: "text", text: "Old answer [P1].", state: "done" }],
    order: 0,
    stepOrder: 1,
    _creationTime: 1,
  },
  {
    id: "u_new",
    key: "u_new",
    role: "user",
    status: "success",
    parts: [{ type: "text", text: "Question after update" }],
    order: 1,
    stepOrder: 0,
    _creationTime: 2,
  },
] as never[];

vi.mock("@convex-dev/agent/react", () => ({
  useUIMessages: () => ({
    results: threadMessages,
    status: "Loaded",
  }),
}));

vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(async () => ({ started: false })),
  useQuery: (query: string) =>
    query === "listSourceEventsForThread"
      ? [
          {
            _id: "event_1",
            _creationTime: 1,
            jobId: "job_1",
            threadId: "thread_1",
            kind: "sources_updated",
            boundaryOrder: 1,
            createdAt: 1,
          },
        ]
      : undefined,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    chat: {
      messages: {
        listThreadMessages: "listThreadMessages",
        getChatWebSearchPricing: "getChatWebSearchPricing",
        regenerateLastAssistant: "regenerateLastAssistant",
      },
      sourceEvents: {
        listForThread: "listSourceEventsForThread",
      },
    },
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/ai-elements/conversation", () => ({
  ConversationScrollButton: () => null,
  Conversation: ({ children, ...props }: React.ComponentProps<"div">) => (
    <div {...props}>{children}</div>
  ),
  ConversationContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/extraction/chat/message-actions", () => ({
  MessageActions: () => null,
}));

vi.mock("@/components/extraction/chat/paper-citation", () => ({
  PaperCitation: ({ index }: { index: number }) => {
    const deprecated = useDeprecatedPaperCitations();
    return (
      <span
        data-testid={`citation-${index}`}
        data-citation-state={deprecated ? "deprecated" : "included"}
      >
        {index}
      </span>
    );
  },
}));

describe("<MessageList> source update events", () => {
  it("renders the source-update divider and deprecates earlier assistant citations", () => {
    render(
      <MessageList
        threadId="thread_1"
        chatModelId={null}
        chatModels={[]}
        isJobGenerating={false}
      />,
    );

    expect(screen.getByText("chatSourcesUpdatedDivider")).toBeInTheDocument();
    expect(screen.getByTestId("citation-1")).toHaveAttribute(
      "data-citation-state",
      "deprecated",
    );
    expect(screen.getByText("Question after update")).toBeInTheDocument();
  });
});
