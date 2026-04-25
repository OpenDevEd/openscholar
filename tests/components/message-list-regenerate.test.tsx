/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UIMessage } from "@convex-dev/agent/react";
import { MessageList } from "@/components/extraction/chat/message-list";

let uiMessages: UIMessage[] = [];
const regenerateMock = vi.fn();
const activityMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    if (key === "chatFailedMessage") return "Response failed";
    return key;
  },
}));

vi.mock("@convex-dev/agent/react", async () => {
  const actual = await vi.importActual<
    typeof import("@convex-dev/agent/react")
  >("@convex-dev/agent/react");
  return {
    ...actual,
    useUIMessages: () => ({ results: uiMessages, status: "Loaded" }),
  };
});

vi.mock("convex/react", () => ({
  useMutation: () => regenerateMock,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    chat: {
      messages: {
        listThreadMessages: "listThreadMessages",
        regenerateLastAssistant: "regenerateLastAssistant",
      },
    },
  },
}));

vi.mock("@/components/ai-elements/message", () => ({
  MessageResponse: ({ children }: { children: string }) => (
    <div data-testid="response">{children}</div>
  ),
}));

vi.mock("@/components/ai-elements/conversation", () => ({
  Conversation: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="conversation">{children}</div>
  ),
  ConversationContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/extraction/chat/paper-citation", () => ({
  PaperCitation: () => null,
}));

vi.mock("@/components/extraction/chat/message-actions", () => ({
  MessageActions: ({ onRetry }: { onRetry: () => void }) => (
    <button type="button" onClick={onRetry}>
      Regenerate response
    </button>
  ),
}));

vi.mock("@/components/extraction/chat/chat-error-alert", async () => {
  const { parseChatError } = await vi.importActual<
    typeof import("@/lib/errors/taxonomy")
  >("@/lib/errors/taxonomy");
  return {
    ChatErrorAlert: ({ rawError }: { rawError: string }) => {
      const envelope = parseChatError(rawError);
      return (
        <div
          role="alert"
          data-testid="chat-error-alert"
          data-error-code={envelope?.class}
        >
          {envelope?.message}
        </div>
      );
    },
  };
});

vi.mock("@/components/extraction/chat/jump-to-latest-pill", () => ({
  JumpToLatestPill: () => null,
}));

function makeMessage(overrides: Partial<UIMessage>): UIMessage {
  return {
    id: "m_default",
    key: "m_default",
    role: "assistant",
    status: "success",
    order: 0,
    stepOrder: 0,
    _creationTime: 0,
    parts: [{ type: "text", text: "done" }],
    text: "done",
    ...overrides,
  } as UIMessage;
}

type RenderListOptions = {
  isJobGenerating?: boolean;
  jobError?: {
    code:
      | "context_too_long"
      | "network"
      | "provider_5xx"
      | "unknown"
      | "regenerate_failed";
    message: string;
    httpStatus?: number;
    providerName?: string;
  } | null;
};

function renderList({
  isJobGenerating = false,
  jobError = null,
}: RenderListOptions = {}) {
  return render(
    <MessageList
      threadId="t_1"
      chatModelId={null}
      chatModels={[]}
      isJobGenerating={isJobGenerating}
      jobError={jobError}
      onGenerationActivityChange={activityMock}
    />,
  );
}

beforeEach(() => {
  uiMessages = [
    makeMessage({
      id: "m_user",
      key: "m_user",
      role: "user",
      order: 1,
      stepOrder: 0,
      text: "question",
      parts: [{ type: "text", text: "question" }],
    }),
    makeMessage({
      id: "m_assistant_old",
      key: "m_assistant_old",
      role: "assistant",
      status: "success",
      order: 1,
      stepOrder: 1,
      text: "old answer",
      parts: [{ type: "text", text: "old answer" }],
    }),
  ];
  regenerateMock.mockReset();
  regenerateMock.mockResolvedValue({
    started: true,
    generationAttemptId: "attempt_regenerate",
  });
  activityMock.mockReset();
});

describe("<MessageList> regenerate state", () => {
  it("shows an immediate local streaming assistant and marks generation active", async () => {
    renderList();

    await userEvent.click(
      screen.getByRole("button", { name: /regenerate response/i }),
    );

    expect(regenerateMock).toHaveBeenCalledWith({ threadId: "t_1" });
    const placeholder = document.querySelector(
      '[data-message-id="local-regenerate:m_assistant_old"]',
    );
    expect(placeholder).not.toBeNull();
    expect(placeholder).toHaveAttribute("data-streaming", "true");
    expect(placeholder).toHaveAttribute("data-status", "streaming");
    expect(
      document.querySelector('[data-message-id="m_assistant_old"]'),
    ).toBeNull();
    await waitFor(() => {
      expect(activityMock).toHaveBeenLastCalledWith(true, "attempt_regenerate");
    });
  });

  it("renders the backend reason when no regenerate attempt starts", async () => {
    regenerateMock.mockResolvedValueOnce({ started: false });
    renderList();

    await userEvent.click(
      screen.getByRole("button", { name: /regenerate response/i }),
    );

    await waitFor(
      () => {
        expect(
          document.querySelector(
            '[data-message-id="local-regenerate:m_assistant_old"]',
          ),
        ).toHaveAttribute("data-status", "failed");
      },
      { timeout: 2500 },
    );
    expect(
      document.querySelector('[data-message-id="m_assistant_old"]'),
    ).toBeNull();
    expect(screen.getByTestId("chat-error-alert")).toHaveAttribute(
      "data-error-code",
      "regenerate_failed",
    );
    expect(screen.getByTestId("chat-error-alert")).toHaveTextContent(
      "Regenerate did not start because the latest chat turn has no assistant message or stream artifact to replace.",
    );
    expect(screen.getByTestId("chat-error-alert")).not.toHaveTextContent(
      "Response failed",
    );
    expect(activityMock).toHaveBeenLastCalledWith(false);
  });

  it("uses the recorded provider error when regenerate cannot start after a failed turn", async () => {
    regenerateMock.mockResolvedValueOnce({
      started: false,
      error: {
        code: "context_too_long",
        message:
          "This endpoint's maximum context length is 200000 tokens. However, you requested about 216917 tokens.",
        httpStatus: 400,
        at: 123,
      },
    });
    renderList();

    await userEvent.click(
      screen.getByRole("button", { name: /regenerate response/i }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("chat-error-alert")).toHaveAttribute(
        "data-error-code",
        "context_too_long",
      );
    });
    expect(screen.getByTestId("chat-error-alert")).toHaveTextContent(
      "This endpoint's maximum context length is 200000 tokens. However, you requested about 216917 tokens.",
    );
    expect(screen.getByTestId("chat-error-alert")).not.toHaveTextContent(
      "Regenerate could not start",
    );
  });

  it("does not clear a backend-started placeholder before the job lock has been observed", async () => {
    vi.useFakeTimers();
    try {
      renderList({ isJobGenerating: false });

      fireEvent.click(
        screen.getByRole("button", { name: /regenerate response/i }),
      );

      await act(async () => {
        await Promise.resolve();
      });

      expect(
        document.querySelector(
          '[data-message-id="local-regenerate:m_assistant_old"]',
        ),
      ).not.toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      expect(
        document.querySelector(
          '[data-message-id="local-regenerate:m_assistant_old"]',
        ),
      ).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not invent a regenerate error when the backend has not reported one", async () => {
    vi.useFakeTimers();
    try {
      renderList({ isJobGenerating: false });

      fireEvent.click(
        screen.getByRole("button", { name: /regenerate response/i }),
      );

      await act(async () => {
        await Promise.resolve();
      });

      expect(
        document.querySelector(
          '[data-message-id="local-regenerate:m_assistant_old"]',
        ),
      ).not.toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_100);
      });

      expect(
        document.querySelector(
          '[data-message-id="local-regenerate:m_assistant_old"]',
        ),
      ).toHaveAttribute("data-status", "streaming");
      expect(screen.queryByTestId("chat-error-alert")).toBeNull();
      expect(activityMock).toHaveBeenLastCalledWith(true, "attempt_regenerate");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fail a fresh regenerate from the stale job error that existed before the retry click", async () => {
    vi.useFakeTimers();
    try {
      renderList({
        isJobGenerating: false,
        jobError: {
          code: "context_too_long",
          message:
            "This endpoint's maximum context length is 200000 tokens. However, you requested about 216917 tokens.",
          httpStatus: 400,
        },
      });

      fireEvent.click(
        screen.getByRole("button", { name: /regenerate response/i }),
      );

      await act(async () => {
        await Promise.resolve();
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });

      expect(
        document.querySelector(
          '[data-message-id="local-regenerate:m_assistant_old"]',
        ),
      ).toHaveAttribute("data-status", "streaming");
      expect(screen.queryByTestId("chat-error-alert")).toBeNull();
      expect(activityMock).toHaveBeenLastCalledWith(true, "attempt_regenerate");
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders the recorded backend error if the job stops before a server row arrives", async () => {
    vi.useFakeTimers();
    try {
      const { rerender } = renderList({ isJobGenerating: true });

      fireEvent.click(
        screen.getByRole("button", { name: /regenerate response/i }),
      );

      await act(async () => {
        await Promise.resolve();
      });

      expect(activityMock).toHaveBeenLastCalledWith(true, "attempt_regenerate");

      rerender(
        <MessageList
          threadId="t_1"
          chatModelId={null}
          chatModels={[]}
          isJobGenerating={false}
          jobError={{
            code: "context_too_long",
            message:
              "This endpoint's maximum context length is 200000 tokens. However, you requested about 216917 tokens.",
            httpStatus: 400,
            providerName: "Google AI Studio",
          }}
          onGenerationActivityChange={activityMock}
        />,
      );

      await act(async () => {});

      expect(
        document.querySelector(
          '[data-message-id="local-regenerate:m_assistant_old"]',
        ),
      ).toHaveAttribute("data-status", "failed");
      expect(screen.getByTestId("chat-error-alert")).toHaveAttribute(
        "data-error-code",
        "context_too_long",
      );
      expect(screen.getByTestId("chat-error-alert")).toHaveTextContent(
        "This endpoint's maximum context length is 200000 tokens.",
      );
      expect(screen.getByTestId("chat-error-alert")).not.toHaveTextContent(
        "Response failed",
      );
      expect(activityMock).toHaveBeenLastCalledWith(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders an inline failed assistant when the regenerate mutation rejects", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    regenerateMock.mockRejectedValueOnce(new Error("network down"));
    renderList();

    await userEvent.click(
      screen.getByRole("button", { name: /regenerate response/i }),
    );

    await waitFor(() => {
      expect(
        document.querySelector(
          '[data-message-id="local-regenerate:m_assistant_old"]',
        ),
      ).toHaveAttribute("data-status", "failed");
    });
    expect(screen.getByTestId("chat-error-alert")).toHaveAttribute(
      "data-error-code",
      "unknown",
    );
    expect(screen.getByTestId("chat-error-alert")).toHaveTextContent(
      "network down",
    );
    expect(screen.getByTestId("chat-error-alert")).not.toHaveTextContent(
      "Response failed",
    );
    expect(activityMock).toHaveBeenLastCalledWith(false);
    consoleErrorSpy.mockRestore();
  });

  it("removes the local placeholder and renders the server error row when regenerate fails", async () => {
    const { rerender } = renderList();
    await userEvent.click(
      screen.getByRole("button", { name: /regenerate response/i }),
    );

    uiMessages = [
      makeMessage({
        id: "m_user",
        key: "m_user",
        role: "user",
        order: 1,
        stepOrder: 0,
        text: "question",
        parts: [{ type: "text", text: "question" }],
      }),
      makeMessage({
        id: "m_assistant_failed",
        key: "m_assistant_failed",
        role: "assistant",
        status: "failed",
        order: 1,
        stepOrder: 1,
        text: "",
        parts: [{ type: "text", text: "" }],
        error: "provider failed",
      } as Partial<UIMessage>),
    ];

    rerender(
      <MessageList
        threadId="t_1"
        chatModelId={null}
        chatModels={[]}
        onGenerationActivityChange={activityMock}
      />,
    );

    expect(
      document.querySelector(
        '[data-message-id="local-regenerate:m_assistant_old"]',
      ),
    ).toBeNull();
    expect(screen.getByTestId("chat-error-alert")).toHaveTextContent(
      "provider failed",
    );
    expect(activityMock).toHaveBeenLastCalledWith(false);
  });

  it("removes the local placeholder and renders the successful server replacement", async () => {
    const { rerender } = renderList();
    await userEvent.click(
      screen.getByRole("button", { name: /regenerate response/i }),
    );

    uiMessages = [
      makeMessage({
        id: "m_user",
        key: "m_user",
        role: "user",
        order: 1,
        stepOrder: 0,
        text: "question",
        parts: [{ type: "text", text: "question" }],
      }),
      makeMessage({
        id: "m_assistant_success",
        key: "m_assistant_success",
        role: "assistant",
        status: "success",
        order: 1,
        stepOrder: 1,
        text: "fresh answer",
        parts: [{ type: "text", text: "fresh answer" }],
      }),
    ];

    rerender(
      <MessageList
        threadId="t_1"
        chatModelId={null}
        chatModels={[]}
        onGenerationActivityChange={activityMock}
      />,
    );

    expect(
      document.querySelector('[data-message-id="local-regenerate:m_assistant_old"]'),
    ).toBeNull();
    expect(screen.getByText("fresh answer")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-error-alert")).toBeNull();
    expect(activityMock).toHaveBeenLastCalledWith(false);
  });
});
