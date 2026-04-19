/**
 * @vitest-environment jsdom
 *
 * Behavioral tests for the redesigned <SuggestionChips> empty-state.
 * - Renders the empty-state hero with the headline + 4 suggestion cards
 * - Clicking a card sends that suggestion's prompt via sendMessage
 * - Each card carries a stable data-suggestion-key contract for E2E
 */
import { describe, expect, it, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SuggestionChips } from "@/components/extraction/chat/suggestion-chips";

const sendMessageMock = vi.fn().mockResolvedValue(undefined);

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: { count?: number }) => {
    if (key === "chatEmptyPaperCount" && params)
      return `Grounded on ${params.count} papers`;
    return key;
  },
}));

vi.mock("convex/react", () => ({
  useMutation: () => {
    const fn = sendMessageMock;
    (fn as unknown as { withOptimisticUpdate: () => typeof fn }).withOptimisticUpdate =
      () => fn;
    return fn;
  },
  useQuery: () => undefined,
}));

vi.mock("@convex-dev/agent/react", () => ({
  optimisticallySendMessage: () => () => {},
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    chat: {
      messages: {
        sendMessage: "sendMessage",
        listThreadMessages: "listThreadMessages",
      },
    },
    extraction: {
      queries: { getJobSources: "getJobSources" },
    },
  },
}));

vi.mock("@/lib/toast", () => ({
  useAppToast: () => ({ error: vi.fn() }),
}));

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as typeof ResizeObserver;
  }
});

describe("<SuggestionChips>", () => {
  it("renders the empty-state hero with the headline", () => {
    render(<SuggestionChips threadId="t_1" />);
    expect(screen.getByRole("heading")).toHaveTextContent("chatEmptyHeadline");
  });

  it("renders all 4 suggestion cards as a list", () => {
    render(<SuggestionChips threadId="t_1" />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(4);
    const keys = items.map((el) => el.getAttribute("data-suggestion-key"));
    expect(keys).toEqual([
      "suggestionSummarise",
      "suggestionThemes",
      "suggestionMostCited",
      "suggestionCompare",
    ]);
  });

  it("clicking a suggestion sends its prompt via sendMessage", async () => {
    const user = userEvent.setup();
    sendMessageMock.mockClear();
    render(<SuggestionChips threadId="t_xyz" />);
    const summarise = screen
      .getAllByRole("listitem")
      .find((el) => el.getAttribute("data-suggestion-key") === "suggestionSummarise");
    expect(summarise).toBeTruthy();
    await user.click(summarise!);
    expect(sendMessageMock).toHaveBeenCalledWith({
      threadId: "t_xyz",
      prompt: "suggestionSummarise",
    });
  });
});
