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
import {
  ChatPapersProvider,
  PapersContext,
} from "@/components/extraction/chat/papers-context";
import {
  fakePapersContext,
  mkChatSourceRow,
} from "../helpers/papers-context-fixture";
import type { Id } from "@/convex/_generated/dataModel";

const sendMessageMock = vi.fn().mockResolvedValue(undefined);
const appToastErrorMock = vi.hoisted(() => vi.fn());
let currentChatSourcesQueryResult:
  | undefined
  | {
      rows: ReturnType<typeof mkChatSourceRow>[];
      totalCount: number;
    };

function withOptimisticUpdateMock<T extends ReturnType<typeof vi.fn>>(fn: T) {
  return Object.assign(fn, { withOptimisticUpdate: () => fn });
}

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: { count?: number }) => {
    if (key === "chatEmptyPaperCount" && params)
      return `Grounded on ${params.count} papers`;
    return key;
  },
}));

vi.mock("convex/react", () => ({
  useQuery: (query: unknown) => {
    if (query === "listChatSourcesWithInclusion") {
      return currentChatSourcesQueryResult;
    }
    return undefined;
  },
  useMutation: () => {
    return withOptimisticUpdateMock(sendMessageMock);
  },
}));

vi.mock("@convex-dev/agent/react", () => ({
  optimisticallySendMessage: () => () => {},
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    chat: {
      chatPapers: {
        listChatSourcesWithInclusion: "listChatSourcesWithInclusion",
      },
      messages: {
        sendMessage: "sendMessage",
        listThreadMessages: "listThreadMessages",
      },
    },
  },
}));

vi.mock("@/lib/toast", () => ({
  useAppToast: () => ({ error: appToastErrorMock }),
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

function renderSuggestionChips(totalCount = 3) {
  return render(
    <PapersContext.Provider value={fakePapersContext({ totalCount })}>
      <SuggestionChips threadId="t_1" />
    </PapersContext.Provider>,
  );
}

describe("<SuggestionChips>", () => {
  it("renders the empty-state hero with the headline", () => {
    renderSuggestionChips();
    expect(screen.getByRole("heading")).toHaveTextContent("chatEmptyHeadline");
    expect(screen.getByText("Grounded on 3 papers")).toBeInTheDocument();
  });

  it("renders all 4 suggestion cards as a list", () => {
    renderSuggestionChips();
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
    render(
      <PapersContext.Provider value={fakePapersContext({ totalCount: 3 })}>
        <SuggestionChips threadId="t_xyz" />
      </PapersContext.Provider>,
    );
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

  it("suggestion send failure surfaces an inline retry and does not toast", async () => {
    const user = userEvent.setup();
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    sendMessageMock.mockReset();
    sendMessageMock
      .mockRejectedValueOnce(new Error("suggestion backend down"))
      .mockResolvedValueOnce(undefined);
    appToastErrorMock.mockClear();

    try {
      const { container } = renderSuggestionChips();
      await user.click(
        screen
          .getAllByRole("listitem")
          .find(
            (el) =>
              el.getAttribute("data-suggestion-key") === "suggestionSummarise",
          )!,
      );

      expect(container.querySelector("[data-message-error='true']")).not.toBeNull();
      expect(container.querySelector("[data-error-backend-reason]")).toHaveTextContent(
        "suggestion backend down",
      );
      expect(appToastErrorMock).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: /chatRetryResponse/i }));

      expect(sendMessageMock).toHaveBeenCalledTimes(2);
      expect(container.querySelector("[data-message-error='true']")).toBeNull();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("keeps the paper-count badge authoritative while chat bootstrap is still missing mirrored rows", () => {
    currentChatSourcesQueryResult = {
      rows: [
        mkChatSourceRow({
          chatPaperId: "cp_bootstrap_1" as Id<"chatPapers">,
          sourceId: "src_bootstrap_1" as Id<"extractionJobSources">,
          position: 1,
        }),
      ],
      totalCount: 2,
    };

    render(
      <ChatPapersProvider jobId={"job_bootstrap" as Id<"extractionJobs">}>
        <SuggestionChips threadId="thread_bootstrap" />
      </ChatPapersProvider>,
    );

    expect(
      screen.getByText("Grounded on 2 papers"),
    ).toBeInTheDocument();
  });
});
