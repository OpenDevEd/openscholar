/**
 * @vitest-environment jsdom
 *
 * Plan 03 — clear-history must leave the actual conversation surface empty.
 * This test uses the real ClearConversationDialog + MessageList contract, but
 * stubs surrounding UI chrome so the assertion stays on observable behavior:
 * a stopped turn is visible before clear, then the list rerenders to the empty
 * state after the clear mutation resolves.
 */
import { useState } from "react";
import { describe, expect, it, vi, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UIMessage } from "@convex-dev/agent/react";
import { ClearConversationDialog } from "@/components/extraction/chat/clear-conversation";
import { MessageList } from "@/components/extraction/chat/message-list";

type ChatUIMessage = UIMessage & { error?: string; aborted?: boolean };

const clearThreadMock = vi.fn<({ threadId }: { threadId: string }) => Promise<void>>();
const regenerateMock = vi.fn();

let currentMessages: ChatUIMessage[] = [];
let currentStatus = "Exhausted";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    if (key === "chatAbortedPillLabel") return "Stopped by user";
    if (key === "chatAbortedPillAria") {
      return "This response was stopped by the user";
    }
    if (key === "chatClearTitle") return "Delete history?";
    if (key === "chatClearDescription") {
      return "Remove every message from this conversation.";
    }
    if (key === "chatClearConfirm") return "Delete history";
    if (key === "cancel") return "Cancel";
    if (key === "chatRetryLoadingMessages") return "Loading messages";
    return key;
  },
}));

vi.mock("convex/react", () => ({
  useMutation: (fnRef: unknown) => {
    if (fnRef === "clearThread") return clearThreadMock;
    if (fnRef === "regenerateLastAssistant") return regenerateMock;
    return vi.fn();
  },
  useQuery: () => undefined,
}));

vi.mock("@convex-dev/agent/react", async () => {
  const actual = await vi.importActual<typeof import("@convex-dev/agent/react")>(
    "@convex-dev/agent/react",
  );
  return {
    ...actual,
    useUIMessages: () => ({
      results: currentMessages,
      status: currentStatus,
    }),
  };
});

vi.mock("@/convex/_generated/api", () => ({
  api: {
    chat: {
      messages: {
        clearThread: "clearThread",
        regenerateLastAssistant: "regenerateLastAssistant",
        listThreadMessages: "listThreadMessages",
      },
      sourceEvents: {
        listForThread: "listSourceEventsForThread",
      },
    },
  },
}));

vi.mock("@/lib/toast", () => ({
  useAppToast: () => ({ error: vi.fn() }),
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({
    open,
    children,
  }: {
    open: boolean;
    children: React.ReactNode;
  }) => (open ? <div data-testid="alert-dialog">{children}</div> : null),
  AlertDialogContent: ({
    children,
    ...props
  }: React.ComponentProps<"div">) => <div {...props}>{children}</div>,
  AlertDialogDescription: ({
    children,
  }: {
    children: React.ReactNode;
  }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogAction: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({
      children,
      initial: _initial,
      animate: _animate,
      transition: _transition,
      ...props
    }: React.ComponentProps<"div"> & {
      initial?: unknown;
      animate?: unknown;
      transition?: unknown;
    }) => <div {...props}>{children}</div>,
  },
  useReducedMotion: () => true,
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

vi.mock("@/components/ai-elements/message", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ai-elements/message")>()),
  MessageResponse: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="response">{children}</div>
  ),
}));

vi.mock("@/components/auth/auth-state-panel", () => ({
  AuthStatePanel: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock("@/components/extraction/chat/message-actions", () => ({
  MessageActions: () => <button type="button">Regenerate response</button>,
}));

vi.mock("@/components/extraction/chat/paper-citation", () => ({
  PaperCitation: () => null,
}));

vi.mock("@/components/extraction/chat/chat-error-alert", () => ({
  ChatErrorAlert: () => <div data-testid="chat-error-alert" />,
}));

vi.mock("@/components/extraction/chat/suggestion-chips", () => ({
  SuggestionChips: () => (
    <div data-empty-state="true">
      <div role="list">
        <button type="button" role="listitem" data-suggestion-key="suggestionSummarise">
          Summarise
        </button>
        <button type="button" role="listitem" data-suggestion-key="suggestionThemes">
          Themes
        </button>
        <button
          type="button"
          role="listitem"
          data-suggestion-key="suggestionMostCited"
        >
          Most cited
        </button>
        <button type="button" role="listitem" data-suggestion-key="suggestionCompare">
          Compare
        </button>
      </div>
    </div>
  ),
}));

beforeAll(() => {
  if (typeof globalThis.requestAnimationFrame === "undefined") {
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
  }
});

function makeMessage(over: Partial<ChatUIMessage>): ChatUIMessage {
  return {
    id: "m_1",
    role: "assistant",
    status: "failed",
    parts: [{ type: "text", text: "Partial text before stop…" }],
    text: "Partial text before stop…",
    key: "m_1",
    order: 0,
    stepOrder: 0,
    _creationTime: 0,
    aborted: true,
    ...over,
  } as ChatUIMessage;
}

function ClearConversationHarness() {
  const [messages, setMessages] = useState<ChatUIMessage[]>([
    makeMessage({}),
  ]);

  currentMessages = messages;
  currentStatus = "Exhausted";
  clearThreadMock.mockImplementation(async () => {
    setMessages([]);
  });

  return (
    <>
      <div data-chat-composer="true">
        <textarea />
      </div>
      <MessageList
        threadId="thread_1"
        chatModelId={null}
        chatModels={[]}
      />
      <ClearConversationDialog
        open
        onOpenChange={() => {}}
        threadId="thread_1"
      />
    </>
  );
}

describe("ClearConversationDialog + MessageList", () => {
  it("B8 — clearing a stopped conversation rerenders the empty-state surface", async () => {
    const user = userEvent.setup();
    clearThreadMock.mockReset();
    currentMessages = [];
    currentStatus = "Exhausted";

    render(<ClearConversationHarness />);

    expect(screen.getByRole("status")).toHaveAttribute(
      "data-message-state",
      "aborted",
    );
    expect(
      screen.getByRole("button", { name: /regenerate response/i }),
    ).toBeInTheDocument();
    expect(document.querySelector('[data-message-list="populated"]')).not.toBeNull();

    await user.click(screen.getByRole("button", { name: /delete history/i }));

    await waitFor(() => {
      expect(document.querySelector('[data-message-list="empty"]')).not.toBeNull();
    });

    expect(clearThreadMock).toHaveBeenCalledWith({ threadId: "thread_1" });
    expect(document.querySelector('[data-empty-state="true"]')).not.toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });
});
