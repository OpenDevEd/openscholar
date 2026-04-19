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
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageComposer } from "@/components/extraction/chat/message-composer";
import type { Doc } from "@/convex/_generated/dataModel";

const sendMessageMock = vi.fn().mockResolvedValue(undefined);
const abortMock = vi.fn().mockResolvedValue(undefined);
const swapMock = vi.fn().mockResolvedValue(undefined);

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("convex/react", () => ({
  useMutation: (fnRef: unknown) => {
    if (fnRef === "sendMessage") {
      const fn = sendMessageMock;
      (fn as unknown as { withOptimisticUpdate: () => typeof fn }).withOptimisticUpdate =
        () => fn;
      return fn;
    }
    if (fnRef === "abortGeneration") return abortMock;
    if (fnRef === "swapModel") return swapMock;
    if (fnRef === "listChatModels") return vi.fn();
    return vi.fn();
  },
  useQuery: () => [],
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
    },
  },
}));

vi.mock("@/lib/toast", () => ({
  useAppToast: () => ({ error: vi.fn() }),
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

describe("<MessageComposer>", () => {
  it("Send button is disabled when the input is empty", () => {
    render(<MessageComposer job={makeJob()} threadId="t_1" />);
    const send = screen.getByRole("button", { name: /chatSend/i });
    expect(send).toBeDisabled();
  });

  it("Send button enables once text is typed", async () => {
    const user = userEvent.setup();
    render(<MessageComposer job={makeJob()} threadId="t_1" />);
    await user.type(screen.getByRole("textbox"), "hello");
    expect(screen.getByRole("button", { name: /chatSend/i })).not.toBeDisabled();
  });

  it("Enter alone submits the message (no Shift)", async () => {
    const user = userEvent.setup();
    sendMessageMock.mockClear();
    render(<MessageComposer job={makeJob()} threadId="t_1" />);
    const textarea = screen.getByRole("textbox");
    await user.type(textarea, "hello");
    await user.type(textarea, "{Enter}");
    expect(sendMessageMock).toHaveBeenCalledWith({
      threadId: "t_1",
      prompt: "hello",
    });
  });

  it("Shift+Enter inserts a newline and does NOT submit", async () => {
    const user = userEvent.setup();
    sendMessageMock.mockClear();
    render(<MessageComposer job={makeJob()} threadId="t_1" />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.type(textarea, "line1");
    await user.type(textarea, "{Shift>}{Enter}{/Shift}line2");
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(textarea.value).toContain("line1");
    expect(textarea.value).toContain("line2");
  });

  it("IME composition guard: Enter during composition does not submit", () => {
    sendMessageMock.mockClear();
    render(<MessageComposer job={makeJob()} threadId="t_1" />);
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
    render(<MessageComposer job={makeJob({ isGenerating: true })} threadId="t_1" />);
    expect(screen.getByRole("button", { name: /chatStop/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /chatSend/i })).toBeNull();
  });

  it("Stop button calls abortGeneration with the threadId", async () => {
    const user = userEvent.setup();
    abortMock.mockClear();
    render(<MessageComposer job={makeJob({ isGenerating: true })} threadId="t_xyz" />);
    await user.click(screen.getByRole("button", { name: /chatStop/i }));
    expect(abortMock).toHaveBeenCalledWith({ threadId: "t_xyz" });
  });

  it("exposes data-chat-composer so ClearConversation can refocus the textarea", () => {
    render(<MessageComposer job={makeJob()} threadId="t_1" />);
    const root = document.querySelector('[data-chat-composer="true"]');
    expect(root).not.toBeNull();
    expect(root?.querySelector("textarea")).not.toBeNull();
  });
});
