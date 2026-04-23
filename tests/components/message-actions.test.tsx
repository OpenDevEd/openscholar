/**
 * @vitest-environment jsdom
 *
 * B5 + B6 — <MessageActions> retry affordance across message states.
 * Aborted messages surface to the client as status:"failed" (the agent
 * library maps stream "aborted" → "failed" at the React layer); the
 * existing retry predicate (showRetry = isLastAssistant || isFailed;
 * disabled = isStreaming) covers aborted naturally — this test locks
 * that contract so a future refactor doesn't regress it.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MessageActions } from "@/components/extraction/chat/message-actions";
import type { Id } from "@/convex/_generated/dataModel";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: { model?: string }) => {
    if (key === "chatRetryResponseWith" && params?.model)
      return `Regenerate with ${params.model}`;
    if (key === "chatRetryResponse") return "Regenerate response";
    if (key === "chatCopyMessage") return "Copy message";
    return key;
  },
}));

vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useQuery: () => null,
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
  status: "streaming" | "failed" | "success",
  isLastAssistant: boolean,
  text = "Some assistant reply",
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
        threadId="t_1"
        chatModelId={null as unknown as Id<"models">}
        models={[]}
        alwaysVisible
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
    // Current gate: showRetry=true while streaming (isLastAssistant), but
    // disabled=true. Either way the user cannot trigger a regenerate.
    const retry = screen.queryByRole("button", { name: /regenerate/i });
    if (retry) {
      expect(retry).toBeDisabled();
    } else {
      expect(retry).toBeNull();
    }
  });
});
