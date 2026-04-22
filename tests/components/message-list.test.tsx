/**
 * @vitest-environment jsdom
 *
 * B4 — MessageRow's behavioral branch for aborted vs. real-error assistant
 * messages. Assertions target role/data-* attributes and visible text — never
 * CSS classes or Tailwind strings (CLAUDE.md testing doctrine).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { UIMessage } from "@convex-dev/agent/react";
import { MessageRow } from "@/components/extraction/chat/message-list";
import type { Id } from "@/convex/_generated/dataModel";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    if (key === "chatAbortedPillLabel") return "Stopped by user";
    if (key === "chatAbortedPillAria") return "This response was stopped by the user";
    return key;
  },
}));

// Convex hooks are only used by <MessageActions>'s regenerate mutation and
// model-list query; for row-level rendering we can stub to no-op.
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

vi.mock("@/components/ai-elements/message", () => ({
  MessageResponse: ({ children }: { children: string }) => (
    <div data-testid="response">{children}</div>
  ),
}));

// ChatErrorAlert is a dep we want to observe — stub with a recognizable
// test-id so we can assert its presence/absence per branch.
vi.mock("@/components/extraction/chat/chat-error-alert", () => ({
  ChatErrorAlert: ({ rawError }: { rawError: string }) => (
    <div data-testid="chat-error-alert" data-raw-error={rawError} />
  ),
}));

// Paper-citation rewriting is irrelevant for this suite.
vi.mock("@/components/extraction/chat/paper-citation", () => ({
  PaperCitation: () => null,
}));

// MessageActions pulls in Radix tooltips and its own Convex subscriptions —
// out of scope for this row-layout suite. Swap for a probe we can assert on.
vi.mock("@/components/extraction/chat/message-actions", () => ({
  MessageActions: () => <div data-testid="message-actions" />,
}));

type ChatUIMessage = UIMessage & { error?: string; aborted?: boolean };

function makeMessage(over: Partial<ChatUIMessage>): ChatUIMessage {
  return {
    id: "m_1",
    role: "assistant",
    status: "success",
    parts: [{ type: "text", text: "" }],
    text: "",
    key: "m_1",
    order: 0,
    stepOrder: 0,
    _creationTime: 0,
    ...over,
  } as ChatUIMessage;
}

function renderRow(msg: ChatUIMessage) {
  return render(
    <MessageRow
      message={msg}
      isLastAssistant={true}
      isFirstInGroup={true}
      threadId="t_1"
      chatModelId={null as unknown as Id<"models">}
      chatModels={[]}
      onRetry={() => {}}
      reduceMotion={true}
    />,
  );
}

describe("MessageRow — aborted vs. failed branches", () => {
  it("B4a — aborted assistant message renders the AbortedPill and partial text", () => {
    const msg = makeMessage({
      status: "failed",
      aborted: true,
      text: "Partial text before stop…",
      parts: [{ type: "text", text: "Partial text before stop…" }],
    });
    renderRow(msg);

    expect(screen.getByRole("status")).toHaveAttribute(
      "data-message-state",
      "aborted",
    );
    expect(screen.getByText(/stopped by user/i)).toBeInTheDocument();
    expect(screen.getByTestId("response")).toHaveTextContent(
      /partial text before stop/i,
    );
    expect(screen.queryByTestId("chat-error-alert")).toBeNull();

    const row = document.querySelector('[data-message-id="m_1"]');
    expect(row).not.toBeNull();
    expect(row).toHaveAttribute("data-message-state", "aborted");
    expect(row).toHaveAttribute("data-status", "aborted");
    expect(row).toHaveAttribute("data-error", "false");
  });

  it("B4b — aborted assistant message with no partial text still renders the pill", () => {
    const msg = makeMessage({
      status: "failed",
      aborted: true,
      text: "",
      parts: [{ type: "text", text: "" }],
    });
    renderRow(msg);

    expect(screen.getByRole("status")).toHaveAttribute(
      "data-message-state",
      "aborted",
    );
  });

  it("B4c — real-error (failed + error envelope) assistant message renders ChatErrorAlert, NOT the pill", () => {
    const msg = makeMessage({
      status: "failed",
      error: '{"kind":"rate_limit","message":"…"}',
      text: "",
      parts: [{ type: "text", text: "" }],
    });
    renderRow(msg);

    expect(screen.getByTestId("chat-error-alert")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    const row = document.querySelector('[data-message-id="m_1"]');
    expect(row).toHaveAttribute("data-status", "failed");
    expect(row).toHaveAttribute("data-error", "true");
    expect(row).not.toHaveAttribute("data-message-state");
  });

  it("B4d — a finished assistant message renders neither the pill nor the error alert", () => {
    const msg = makeMessage({
      status: "success",
      text: "All done.",
      parts: [{ type: "text", text: "All done." }],
    });
    renderRow(msg);

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByTestId("chat-error-alert")).toBeNull();
    const row = document.querySelector('[data-message-id="m_1"]');
    expect(row).toHaveAttribute("data-status", "success");
    expect(row).not.toHaveAttribute("data-message-state");
  });
});
