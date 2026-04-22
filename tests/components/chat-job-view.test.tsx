/**
 * @vitest-environment jsdom
 *
 * Plan 01 / D1 behavioral assertion: mounting <ChatJobView> subscribes to
 * `listChatSourcesWithInclusion` **exactly once**. Before the unified
 * provider landed, four siblings each subscribed to the same Convex
 * query — this test locks in the single-subscription contract.
 *
 * Child components are stubbed so the only caller of Convex `useQuery`
 * for this endpoint is `ChatPapersProvider`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { ChatJobView } from "@/components/extraction/chat/chat-job-view";
import type { Doc, Id } from "@/convex/_generated/dataModel";

const useQuerySpy = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (fn: unknown, args: unknown) => {
    useQuerySpy(fn, args);
    if (fn === "stub:listChatSourcesWithInclusion") {
      return { rows: [], totalCount: 0 };
    }
    return [];
  },
  useMutation: () => {
    const fn = vi.fn();
    Object.assign(fn, { withOptimisticUpdate: () => fn });
    return fn;
  },
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    chat: {
      model: {
        listChatModels: "stub:listChatModels",
      },
      chatPapers: {
        listChatSourcesWithInclusion: "stub:listChatSourcesWithInclusion",
      },
    },
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/hooks", () => ({
  useIsMobile: () => false,
  useMediaQuery: () => false,
}));

// Stub every child so the only `useQuery(listChatSourcesWithInclusion)`
// call comes from `ChatPapersProvider`.
vi.mock("@/components/extraction/chat/chat-header", () => ({
  ChatHeader: () => <div data-testid="chat-header" />,
}));
vi.mock("@/components/extraction/chat/message-list", () => ({
  MessageList: () => <div data-testid="message-list" />,
}));
vi.mock("@/components/extraction/chat/message-composer", () => ({
  MessageComposer: () => <div data-testid="message-composer" />,
}));
vi.mock("@/components/extraction/chat/sources-panel", () => ({
  SourcesPanel: () => <div data-testid="sources-panel" />,
  SourcesPanelSheet: () => <div data-testid="sources-panel-sheet" />,
}));
vi.mock("@/components/extraction/chat/use-chat-shortcuts", () => ({
  useChatShortcuts: () => undefined,
}));

function makeJob(): Doc<"extractionJobs"> {
  return {
    _id: "job_test" as Id<"extractionJobs">,
    _creationTime: 0,
    name: "j",
    isGenerating: false,
  } as Doc<"extractionJobs">;
}

describe("<ChatJobView> — unified papers subscription", () => {
  it("mounts a single ChatPapersProvider, issuing one listChatSourcesWithInclusion subscription", () => {
    useQuerySpy.mockClear();
    render(<ChatJobView job={makeJob()} threadId="t1" />);
    const callsForListChatSources = useQuerySpy.mock.calls.filter(
      ([fn]) => fn === "stub:listChatSourcesWithInclusion",
    );
    expect(callsForListChatSources).toHaveLength(1);
    expect(callsForListChatSources[0]?.[1]).toEqual({ jobId: "job_test" });
  });
});

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("<ChatJobView> — tab-visibility subscription pause", () => {
  afterEach(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  it("passes 'skip' to useQuery while the tab is hidden and resubscribes when visible", () => {
    useQuerySpy.mockClear();
    render(<ChatJobView job={makeJob()} threadId="t1" />);

    // Isolate calls to the papers-subscription endpoint — the view also
    // mounts unrelated useQuery consumers we don't care about here.
    const callsFor = () =>
      useQuerySpy.mock.calls.filter(
        ([fn]) => fn === "stub:listChatSourcesWithInclusion",
      );

    // Initial mount: live args object.
    expect(callsFor()).toHaveLength(1);
    expect(callsFor()[0]?.[1]).toEqual({ jobId: "job_test" });

    // Flip hidden → the provider must re-run useQuery with "skip".
    act(() => {
      setVisibility("hidden");
    });
    const hiddenCalls = callsFor();
    expect(hiddenCalls.length).toBeGreaterThan(1);
    expect(hiddenCalls[hiddenCalls.length - 1]?.[1]).toBe("skip");

    // Flip visible → provider re-runs useQuery with the live args object.
    act(() => {
      setVisibility("visible");
    });
    const visibleCalls = callsFor();
    expect(visibleCalls.length).toBeGreaterThan(hiddenCalls.length);
    expect(visibleCalls[visibleCalls.length - 1]?.[1]).toEqual({
      jobId: "job_test",
    });

    // No spurious double-transitions: each visibility flip produces one
    // additional listChatSources call. Anything more than initial + 2
    // would hint at a re-render storm (e.g., both the provider and a
    // listener re-running the query).
    expect(visibleCalls.length - 1).toBe(2);
  });
});
