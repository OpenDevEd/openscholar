import { StrictMode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSearchHistoryStore } from "@/lib/store";
import { SearchInitializer } from "@/lib/search/initializer";

const { replace, execute, enhance, failed, address } = vi.hoisted(() => {
  const execute = vi.fn();
  return {
    replace: vi.fn(),
    execute,
    enhance: { write: execute, isReady: true, isConfigured: true },
    failed: vi.fn(),
    address: { search: "" },
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/results",
  useSearchParams: () => new URLSearchParams(address.search),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en", useTranslations: () => (key: string) => key }));
vi.mock("@/lib/workspaces/href", () => ({ useWorkspaceRouter: () => ({ replace }) }));
vi.mock("@/lib/ai/client/question-query", () => ({ useQuestionToQuery: () => enhance }));
vi.mock("@/lib/toast", () => ({ useAppToast: () => ({ ai: { failed } }) }));

const QUESTION = "does tutoring help?";
const open = (search: string) => {
  address.search = search;
  return render(<StrictMode><SearchInitializer><p>results</p></SearchInitializer></StrictMode>);
};
const searches = () => useSearchHistoryStore.getState().searchHistory;

describe("a new search from a research question in its address", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enhance.isReady = true;
    useSearchHistoryStore.setState({ searchHistory: [] });
  });

  it("makes one search from one written query, and the address it goes to no longer asks", async () => {
    execute.mockResolvedValue("tutoring AND help");
    open(`?question=${encodeURIComponent(QUESTION)}&yf=2015&yt=2020`);

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0]).toMatchObject({ question: QUESTION });
    expect(searches()).toHaveLength(1);
    expect(searches()[0]).toMatchObject({ query: "tutoring AND help", latestQuestion: QUESTION, yearRange: [2015, 2020] });
    const url = new URL(replace.mock.calls[0]![0] as string, "http://test");
    expect(url.pathname).toBe(`/results/${searches()[0]!.id}`);
    expect(url.searchParams.get("q")).toBe("tutoring AND help");
    expect(url.searchParams.has("question")).toBe(false);
  });

  it("waits until it's known who pays", async () => {
    execute.mockResolvedValue("tutoring");
    enhance.isReady = false;
    const page = open(`?question=${encodeURIComponent(QUESTION)}`);
    await act(async () => {});
    expect(execute).not.toHaveBeenCalled();

    enhance.isReady = true;
    page.rerender(<StrictMode><SearchInitializer><p>results</p></SearchInitializer></StrictMode>);
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("opens with no query and the question kept when the query can't be written", async () => {
    execute.mockRejectedValue(new Error("no credits"));
    open(`?question=${encodeURIComponent(QUESTION)}`);

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(failed).toHaveBeenCalledTimes(1);
    expect(searches()).toHaveLength(1);
    expect(searches()[0]).toMatchObject({ query: "", latestQuestion: QUESTION });
  });

  it("makes no search and sends no one anywhere after the person has left", async () => {
    let answer!: (value: string) => void;
    execute.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    const page = open(`?question=${encodeURIComponent(QUESTION)}`);
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));

    page.unmount();
    await act(async () => answer("tutoring"));
    expect(searches()).toHaveLength(0);
    expect(replace).not.toHaveBeenCalled();
  });

  it("drops the old answer when the address changes while it's being written, and follows the new one", async () => {
    let answer!: (value: string) => void;
    execute.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    const page = open(`?question=${encodeURIComponent(QUESTION)}`);
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));

    address.search = "?q=tutors";
    page.rerender(<StrictMode><SearchInitializer><p>results</p></SearchInitializer></StrictMode>);
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    await act(async () => answer("old answer"));

    expect(replace).toHaveBeenCalledTimes(1);
    expect(searches()).toHaveLength(1);
    expect(searches()[0]).toMatchObject({ query: "tutors" });
  });

  it("spends nothing when the address has its query, and keeps the question", async () => {
    open(`?q=tutors&question=${encodeURIComponent(QUESTION)}`);

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(execute).not.toHaveBeenCalled();
    expect(searches()).toHaveLength(1);
    expect(searches()[0]).toMatchObject({ query: "tutors", latestQuestion: QUESTION });
  });

  it("treats a blank question as none", async () => {
    open("?question=%20%20");

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(execute).not.toHaveBeenCalled();
    expect(searches()[0]?.latestQuestion).toBeUndefined();
    expect(screen.queryByText("results")).toBeNull();
  });
});
