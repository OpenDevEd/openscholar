/**
 * @vitest-environment jsdom
 *
 * Behavioral tests for the redesigned <MessageComposer>.
 *
 * Locks the contract the user explicitly asked us to fix:
 * - Enter sends (the previous composer required Cmd/Ctrl+Enter — backwards
 *   from every reference app)
 * - Shift+Enter inserts a newline (no submit)
 * - IME composition guard: Enter during composition does NOT submit (otherwise
 *   Japanese / Chinese / Korean users accidentally send mid-character)
 * - Send button is disabled while the input is empty
 * - When the job is generating, the Stop control replaces the Send control
 * - The composer surfaces data-chat-composer="true" so ClearConversation
 *   can restore focus to the textarea after closing the dialog
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { waitFor } from "@testing-library/react";
import {
  render,
  screen,
  fireEvent,
  type RenderOptions,
  type RenderResult,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageComposer } from "@/components/extraction/chat/message-composer";
import { PapersContext } from "@/components/extraction/chat/papers-context";
import {
  fakePapersContext,
  mkChatSourceRow,
} from "@/tests/helpers/papers-context-fixture";
import type { Doc, Id } from "@/convex/_generated/dataModel";

const sendMessageMock = vi.fn().mockResolvedValue(undefined);
const abortMock = vi.fn().mockResolvedValue({ stopped: true });
const swapMock = vi.fn().mockResolvedValue(undefined);
const appToastErrorMock = vi.hoisted(() => vi.fn());

function withOptimisticUpdateMock<T extends ReturnType<typeof vi.fn>>(fn: T) {
  return Object.assign(fn, { withOptimisticUpdate: () => fn });
}

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("convex/react", () => ({
  useMutation: (fnRef: unknown) => {
    if (fnRef === "sendMessage") {
      return withOptimisticUpdateMock(sendMessageMock);
    }
    if (fnRef === "abortGeneration") return abortMock;
    if (fnRef === "swapModel") return swapMock;
    if (fnRef === "listChatModels") return vi.fn();
    if (fnRef === "bulkSetChatPapers") {
      return withOptimisticUpdateMock(
        vi.fn().mockResolvedValue({ changedCount: 0 }),
      );
    }
    return vi.fn();
  },
}));

vi.mock("@convex-dev/agent/react", () => ({
  optimisticallySendMessage: () => () => {},
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    chat: {
      messages: {
        sendMessage: "sendMessage",
        abortGeneration: "abortGeneration",
        swapModel: "swapModel",
        listThreadMessages: "listThreadMessages",
      },
      model: {
        listChatModels: "listChatModels",
      },
      chatPapers: {
        listChatSourcesWithInclusion: "listChatSourcesWithInclusion",
        bulkSetChatPapers: "bulkSetChatPapers",
      },
    },
  },
}));

vi.mock("@/lib/toast", () => ({
  useAppToast: () => ({ error: appToastErrorMock }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Composer model picker has its own concerns (Convex query, popover);
// stub it so this suite stays focused on the composer's input behavior.
vi.mock("@/components/extraction/chat/composer-model-picker", () => ({
  ComposerModelPicker: () => <div data-testid="composer-model-picker" />,
}));

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as typeof ResizeObserver;
  }
});

function makeJob(over: Partial<Doc<"extractionJobs">> = {}): Doc<"extractionJobs"> {
  return {
    _id: "job_1" as Doc<"extractionJobs">["_id"],
    _creationTime: 0,
    name: "j",
    isGenerating: false,
    ...over,
  } as Doc<"extractionJobs">;
}

function renderWithSources(
  ui: React.ReactElement,
  {
    jobId,
    rows,
    ...options
  }: {
    jobId?: Id<"extractionJobs">;
    rows?: ReturnType<typeof mkChatSourceRow>[];
  } & Omit<RenderOptions, "wrapper"> = {},
): RenderResult {
  const effectiveJobId = jobId ?? ("job_1" as Id<"extractionJobs">);
  const effectiveRows =
    rows ?? [mkChatSourceRow({ included: true })];
  const ctx = fakePapersContext({ jobId: effectiveJobId, rows: effectiveRows });
  return render(
    <PapersContext.Provider value={ctx}>{ui}</PapersContext.Provider>,
    options,
  );
}

describe("<MessageComposer>", () => {
  it("Send button is disabled when the input is empty", () => {
    renderWithSources(<MessageComposer job={makeJob()} threadId="t_1" />);
    const send = screen.getByRole("button", { name: /chatSend/i });
    expect(send).toBeDisabled();
  });

  it("Send button enables once text is typed", async () => {
    const user = userEvent.setup();
    renderWithSources(<MessageComposer job={makeJob()} threadId="t_1" />);
    await user.type(screen.getByRole("textbox"), "hello");
    expect(screen.getByRole("button", { name: /chatSend/i })).not.toBeDisabled();
  });

  it("Enter alone submits the message (no Shift)", async () => {
    const user = userEvent.setup();
    sendMessageMock.mockClear();
    renderWithSources(<MessageComposer job={makeJob()} threadId="t_1" />);
    const textarea = screen.getByRole("textbox");
    await user.type(textarea, "hello");
    await user.type(textarea, "{Enter}");
    expect(sendMessageMock).toHaveBeenCalledWith({
      threadId: "t_1",
      prompt: "hello",
    });
  });

  it("send failure restores the prompt, surfaces an inline retry, and does not toast", async () => {
    const user = userEvent.setup();
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    sendMessageMock.mockReset();
    sendMessageMock
      .mockRejectedValueOnce(new Error("backend down"))
      .mockResolvedValueOnce(undefined);
    appToastErrorMock.mockClear();

    try {
      const { container } = renderWithSources(
        <MessageComposer job={makeJob()} threadId="t_1" />,
      );
      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
      await user.type(textarea, "hello");
      await user.click(screen.getByRole("button", { name: /chatSend/i }));

      await waitFor(() => {
        expect(container.querySelector("[data-message-error='true']")).not.toBeNull();
      });
      expect(textarea.value).toBe("hello");
      expect(container.querySelector("[data-error-backend-reason]")).toHaveTextContent(
        "backend down",
      );
      expect(appToastErrorMock).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: /chatRetryResponse/i }));

      await waitFor(() => {
        expect(sendMessageMock).toHaveBeenCalledTimes(2);
      });
      expect(container.querySelector("[data-message-error='true']")).toBeNull();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("Shift+Enter inserts a newline and does NOT submit", async () => {
    const user = userEvent.setup();
    sendMessageMock.mockClear();
    renderWithSources(<MessageComposer job={makeJob()} threadId="t_1" />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.type(textarea, "line1");
    await user.type(textarea, "{Shift>}{Enter}{/Shift}line2");
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(textarea.value).toContain("line1");
    expect(textarea.value).toContain("line2");
  });

  it("IME composition guard: Enter during composition does not submit", () => {
    sendMessageMock.mockClear();
    renderWithSources(<MessageComposer job={makeJob()} threadId="t_1" />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "こん" } });
    fireEvent.compositionStart(textarea);
    fireEvent.keyDown(textarea, {
      key: "Enter",
      code: "Enter",
      keyCode: 229,
      // older Webkit dispatches Enter inside composition with keyCode 229
    });
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("Stop button replaces Send while the job is generating", () => {
    renderWithSources(
      <MessageComposer
        job={makeJob({
          isGenerating: true,
          chatGenerationAttemptId: "attempt_1",
        })}
        threadId="t_1"
      />,
    );
    expect(screen.getByRole("button", { name: /chatStop/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /chatSend/i })).toBeNull();
  });

  it("Stop button calls abortGeneration with the threadId and current attempt id", async () => {
    const user = userEvent.setup();
    abortMock.mockClear();
    renderWithSources(
      <MessageComposer
        job={makeJob({
          isGenerating: true,
          chatGenerationAttemptId: "attempt_current",
        })}
        threadId="t_xyz"
      />,
    );
    await user.click(screen.getByRole("button", { name: /chatStop/i }));
    expect(abortMock).toHaveBeenCalledWith({
      threadId: "t_xyz",
      generationAttemptId: "attempt_current",
    });
  });

  it("Stop button is disabled until the current attempt id is known", () => {
    renderWithSources(
      <MessageComposer job={makeJob({ isGenerating: true })} threadId="t_xyz" />,
    );

    expect(screen.getByRole("button", { name: /chatStop/i })).toBeDisabled();
  });

  it("Stop click does not show a toast; the stopped message state is the feedback", async () => {
    const user = userEvent.setup();
    abortMock.mockClear();
    abortMock.mockResolvedValueOnce({ stopped: true });
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
    (toast.error as ReturnType<typeof vi.fn>).mockClear();
    renderWithSources(
      <MessageComposer
        job={makeJob({
          isGenerating: true,
          chatGenerationAttemptId: "attempt_current",
        })}
        threadId="t_xyz"
      />,
    );
    await user.click(screen.getByRole("button", { name: /chatStop/i }));
    await waitFor(() => {
      expect(abortMock).toHaveBeenCalledWith({
        threadId: "t_xyz",
        generationAttemptId: "attempt_current",
      });
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("Stop click on a failing mutation logs without showing a toast", async () => {
    const user = userEvent.setup();
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    abortMock.mockClear();
    abortMock.mockRejectedValueOnce(new Error("network"));
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
    (toast.error as ReturnType<typeof vi.fn>).mockClear();
    renderWithSources(
      <MessageComposer
        job={makeJob({
          isGenerating: true,
          chatGenerationAttemptId: "attempt_current",
        })}
        threadId="t_xyz"
      />,
    );
    await user.click(screen.getByRole("button", { name: /chatStop/i }));
    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("B7 — Stop disappears once the job stops generating; Send returns", async () => {
    const { rerender } = renderWithSources(
      <MessageComposer
        job={makeJob({
          isGenerating: true,
          chatGenerationAttemptId: "attempt_current",
        })}
        threadId="t_1"
      />,
    );
    expect(screen.getByRole("button", { name: /chatStop/i })).toBeTruthy();

    rerender(
      <PapersContext.Provider
        value={fakePapersContext({
          jobId: "job_1" as Id<"extractionJobs">,
          rows: [mkChatSourceRow({ included: true })],
        })}
      >
        <MessageComposer
          job={makeJob({ isGenerating: false })}
          threadId="t_1"
        />
      </PapersContext.Provider>,
    );
    // AnimatePresence runs an exit transition on the stop button; wait
    // for it to leave the DOM before asserting the send button is back.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /chatStop/i })).toBeNull();
    });
    expect(
      screen.getByRole("button", { name: /chatSend/i }),
    ).toBeInTheDocument();
  });

  it("exposes data-chat-composer so ClearConversation can refocus the textarea", () => {
    renderWithSources(<MessageComposer job={makeJob()} threadId="t_1" />);
    const root = document.querySelector('[data-chat-composer="true"]');
    expect(root).not.toBeNull();
    expect(root?.querySelector("textarea")).not.toBeNull();
  });
});
