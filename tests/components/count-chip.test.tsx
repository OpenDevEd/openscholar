/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { useHistoryCountMock, updatePaperCountMock, refreshMock } = vi.hoisted(
  () => ({
    useHistoryCountMock: vi.fn(),
    updatePaperCountMock: vi.fn(),
    refreshMock: vi.fn(),
  }),
);

vi.mock("@/lib/hooks/use-history-count", () => ({
  useHistoryCount: (...args: unknown[]) => useHistoryCountMock(...args),
}));

vi.mock("@/lib/store/bucket", () => ({
  useBucketStore: (selector: (s: unknown) => unknown) =>
    selector({ updatePaperCount: updatePaperCountMock }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () =>
    (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  useFormatter: () => ({
    number: (n: number) => String(n),
  }),
}));

vi.mock("lucide-react", () => ({
  Minus: () => null,
  Plus: () => null,
  ChevronDown: () => null,
}));

vi.mock("@/components/ui/popover", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Popover: Passthrough,
    PopoverTrigger: ({
      children,
      asChild,
    }: {
      children: React.ReactNode;
      asChild?: boolean;
    }) =>
      asChild ? (
        <>{children}</>
      ) : (
        <div data-testid="popover-trigger">{children}</div>
      ),
    PopoverContent: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="popover-content">{children}</div>
    ),
    PopoverHeader: Passthrough,
    PopoverTitle: Passthrough,
    PopoverDescription: Passthrough,
  };
});

import { CountChip } from "@/components/extraction/bucket/count-chip";
import type { SearchResult } from "@/lib/types";

function makeEntry(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: "sr_1",
    query: "cancer therapy",
    queryHistory: [],
    questionHistory: [],
    queryHistoryCount: 0,
    questionCount: 0,
    questionText: "",
    screeningQuestions: [],
    screeningResponses: {},
    count: 3000,
    field: "title_and_abstract",
    yearRange: [2020, 2024],
    filterType: "year",
    isYearRangeEnabled: true,
    sortBy: "relevance_score:desc",
    selectedRegions: [],
    selectedCountryFocus: [],
    reviewFilter: false,
    citesItemId: "",
    citedByItemId: "",
    relatedToItemId: "",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function loading() {
  return {
    count: undefined,
    isLoading: true,
    error: undefined,
    refresh: refreshMock,
  };
}
function resolved(count: number) {
  return {
    count,
    isLoading: false,
    error: undefined,
    refresh: refreshMock,
  };
}
function errored() {
  return {
    count: undefined,
    isLoading: false,
    error: new Error("boom"),
    refresh: refreshMock,
  };
}

beforeEach(() => {
  useHistoryCountMock.mockReset();
  updatePaperCountMock.mockReset();
  refreshMock.mockReset();
});

describe("<CountChip>", () => {
  it("renders the chip trigger with aria-label mentioning count and query", () => {
    useHistoryCountMock.mockReturnValue(loading());
    render(
      <CountChip
        entry={makeEntry()}
        bucketKey="history:sr_1"
        paperCount={200}
        cap={200}
        defaultCount={200}
      />,
    );
    const trigger = screen.getByRole("button", { name: /chipLabel/ });
    const label = trigger.getAttribute("aria-label") ?? "";
    expect(label).toContain("200");
    expect(label).toContain("cancer therapy");
  });

  it("shows a skeleton for 'available' while fresh count is loading", () => {
    useHistoryCountMock.mockReturnValue(loading());
    const { container } = render(
      <CountChip
        entry={makeEntry()}
        bucketKey="history:sr_1"
        paperCount={200}
        cap={200}
        defaultCount={200}
      />,
    );
    expect(container.querySelector("[data-slot=skeleton-bar]")).toBeTruthy();
  });

  it("caps stepper max at `cap` when fresh > cap and shows 'cap applies'", () => {
    useHistoryCountMock.mockReturnValue(resolved(5000));
    render(
      <CountChip
        entry={makeEntry({ count: 3000 })}
        bucketKey="history:sr_1"
        paperCount={200}
        cap={200}
        defaultCount={200}
      />,
    );
    const spinbutton = screen.getByRole("spinbutton");
    expect(spinbutton.getAttribute("aria-valuemax")).toBe("200");
    expect(screen.getByTestId("popover-content").textContent).toContain(
      "capApplies",
    );
    expect(screen.getByTestId("popover-content").textContent).toContain(
      "available",
    );
  });

  it("clamps paperCount down when fresh resolves below current paperCount", () => {
    useHistoryCountMock.mockReturnValue(resolved(120));
    render(
      <CountChip
        entry={makeEntry()}
        bucketKey="history:sr_1"
        paperCount={200}
        cap={200}
        defaultCount={200}
      />,
    );
    expect(updatePaperCountMock).toHaveBeenCalledWith(
      "history:sr_1",
      120,
      200,
    );
  });

  it("preset '50' commits 50", () => {
    useHistoryCountMock.mockReturnValue(resolved(500));
    render(
      <CountChip
        entry={makeEntry()}
        bucketKey="history:sr_1"
        paperCount={100}
        cap={200}
        defaultCount={200}
      />,
    );
    updatePaperCountMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /presetFifty/ }));
    expect(updatePaperCountMock).toHaveBeenCalledWith(
      "history:sr_1",
      50,
      200,
    );
  });

  it("preset 'Max' commits min(cap, fresh)", () => {
    useHistoryCountMock.mockReturnValue(resolved(120));
    render(
      <CountChip
        entry={makeEntry()}
        bucketKey="history:sr_1"
        paperCount={100}
        cap={200}
        defaultCount={200}
      />,
    );
    updatePaperCountMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /presetMax/ }));
    expect(updatePaperCountMock).toHaveBeenCalledWith(
      "history:sr_1",
      120,
      200,
    );
  });

  it("stepper + button commits paperCount + 1", () => {
    useHistoryCountMock.mockReturnValue(resolved(500));
    render(
      <CountChip
        entry={makeEntry()}
        bucketKey="history:sr_1"
        paperCount={100}
        cap={200}
        defaultCount={200}
      />,
    );
    updatePaperCountMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /step.*\+1/ }));
    expect(updatePaperCountMock).toHaveBeenCalledWith(
      "history:sr_1",
      101,
      200,
    );
  });

  it("input blur with a valid number commits that number", () => {
    useHistoryCountMock.mockReturnValue(resolved(500));
    render(
      <CountChip
        entry={makeEntry()}
        bucketKey="history:sr_1"
        paperCount={100}
        cap={200}
        defaultCount={200}
      />,
    );
    updatePaperCountMock.mockClear();
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "75" } });
    fireEvent.blur(input);
    expect(updatePaperCountMock).toHaveBeenCalledWith(
      "history:sr_1",
      75,
      200,
    );
  });

  it("input blur with a value above cap clamps to cap", () => {
    useHistoryCountMock.mockReturnValue(resolved(500));
    render(
      <CountChip
        entry={makeEntry()}
        bucketKey="history:sr_1"
        paperCount={100}
        cap={200}
        defaultCount={200}
      />,
    );
    updatePaperCountMock.mockClear();
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "999" } });
    fireEvent.blur(input);
    expect(updatePaperCountMock).toHaveBeenCalledWith(
      "history:sr_1",
      200,
      200,
    );
  });

  it("falls back to cached count with '(cached)' tag when fresh errors", () => {
    useHistoryCountMock.mockReturnValue(errored());
    render(
      <CountChip
        entry={makeEntry({ count: 300 })}
        bucketKey="history:sr_1"
        paperCount={100}
        cap={200}
        defaultCount={200}
      />,
    );
    const content = screen.getByTestId("popover-content").textContent ?? "";
    expect(content).toContain("cached");
    // stepper max = min(cap=200, cached=300) = 200
    const spinbutton = screen.getByRole("spinbutton");
    expect(spinbutton.getAttribute("aria-valuemax")).toBe("200");
  });

  it("spinbutton exposes aria-valuemin / valuemax / valuenow", () => {
    useHistoryCountMock.mockReturnValue(resolved(500));
    render(
      <CountChip
        entry={makeEntry()}
        bucketKey="history:sr_1"
        paperCount={75}
        cap={200}
        defaultCount={200}
      />,
    );
    const spinbutton = screen.getByRole("spinbutton");
    expect(spinbutton.getAttribute("aria-valuemin")).toBe("0");
    expect(spinbutton.getAttribute("aria-valuemax")).toBe("200");
    expect(spinbutton.getAttribute("aria-valuenow")).toBe("75");
  });

  it("live region announces the new count after a commit", async () => {
    useHistoryCountMock.mockReturnValue(resolved(500));
    const { container } = render(
      <CountChip
        entry={makeEntry()}
        bucketKey="history:sr_1"
        paperCount={100}
        cap={200}
        defaultCount={200}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /presetFifty/ }));
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).toBeTruthy();
    expect(live?.textContent ?? "").toContain("liveAnnouncement");
    expect(live?.textContent ?? "").toContain("50");
  });

  it("keyboard ArrowUp increments, ArrowDown decrements", () => {
    useHistoryCountMock.mockReturnValue(resolved(500));
    render(
      <CountChip
        entry={makeEntry()}
        bucketKey="history:sr_1"
        paperCount={50}
        cap={200}
        defaultCount={200}
      />,
    );
    updatePaperCountMock.mockClear();
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(updatePaperCountMock).toHaveBeenLastCalledWith(
      "history:sr_1",
      51,
      200,
    );
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(updatePaperCountMock).toHaveBeenLastCalledWith(
      "history:sr_1",
      49,
      200,
    );
  });

  it("keyboard Home jumps to 0, End jumps to stepperMax", () => {
    useHistoryCountMock.mockReturnValue(resolved(500));
    render(
      <CountChip
        entry={makeEntry()}
        bucketKey="history:sr_1"
        paperCount={50}
        cap={200}
        defaultCount={200}
      />,
    );
    updatePaperCountMock.mockClear();
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.keyDown(input, { key: "Home" });
    expect(updatePaperCountMock).toHaveBeenLastCalledWith(
      "history:sr_1",
      0,
      200,
    );
    fireEvent.keyDown(input, { key: "End" });
    expect(updatePaperCountMock).toHaveBeenLastCalledWith(
      "history:sr_1",
      200,
      200,
    );
  });
});
