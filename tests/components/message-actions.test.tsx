/**
 * @vitest-environment jsdom
 *
 * B5 + B6 — <MessageActions> retry affordance across message states.
 * Regenerate is a latest-turn operation, so the compact action is only
 * visible for the latest assistant message and is disabled while that row is
 * pending or streaming.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MessageActions } from "@/components/extraction/chat/message-actions";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: { model?: string }) => {
    if (key === "chatRetryResponseWith" && params?.model)
      return `Regenerate with ${params.model}`;
    if (key === "chatRetryResponse") return "Regenerate response";
    if (key === "chatCopyMessage") return "Copy message";
    return key;
  },
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    chat: {
      messages: { regenerateLastAssistant: "regenerateLastAssistant" },
      model: { listChatModels: "listChatModels" },
    },
  },
}));

vi.mock("@/lib/toast", () => ({
  useAppToast: () => ({ error: vi.fn(), clipboard: { copyFailed: vi.fn() } }),
}));

function renderActions(
  status: "pending" | "streaming" | "failed" | "success",
  isLastAssistant: boolean,
  text = "Some assistant reply",
  onRetry = vi.fn(),
) {
  return render(
    <TooltipProvider>
      <MessageActions
        message={{
          role: "assistant",
          status,
          text,
          parts: [{ type: "text", text }],
        }}
        isLastAssistant={isLastAssistant}
        chatModelId={null}
        models={[]}
        alwaysVisible
        onRetry={onRetry}
      />
    </TooltipProvider>,
  );
}

describe("<MessageActions> retry enablement", () => {
  it("B5 — retry is present and ENABLED for a status=failed assistant (aborted surfaces here)", () => {
    renderActions("failed", true);
    const retry = screen.getByRole("button", { name: /regenerate/i });
    expect(retry).toBeEnabled();
  });

  it("B5a — retry is hidden for older failed assistants because regenerate targets the latest turn", () => {
    renderActions("failed", false);

    expect(screen.queryByRole("button", { name: /regenerate/i })).toBeNull();
  });

  it("B5b — retry is ENABLED for a finished last assistant message (regression guard)", () => {
    renderActions("success", true);
    const retry = screen.getByRole("button", { name: /regenerate/i });
    expect(retry).toBeEnabled();
  });

  it("B5c — an empty stopped/failed message still offers regenerate but not copy", () => {
    renderActions("failed", true, "");
    expect(
      screen.getByRole("button", { name: /regenerate/i }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: /copy message/i }),
    ).toBeNull();
  });

  it("B6 — retry is not clickable while the message is streaming", () => {
    renderActions("streaming", true);
    expect(screen.getByRole("button", { name: /regenerate/i })).toBeDisabled();
  });

  it("B6a — retry is not clickable while the message is pending", () => {
    renderActions("pending", true);
    expect(screen.getByRole("button", { name: /regenerate/i })).toBeDisabled();
  });

  it("B7 — clicking retry delegates to the parent regenerate handler", async () => {
    const onRetry = vi.fn();
    renderActions("success", true, "Some assistant reply", onRetry);

    screen.getByRole("button", { name: /regenerate/i }).click();

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
