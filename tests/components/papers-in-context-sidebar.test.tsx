/**
 * @vitest-environment jsdom
 *
 * Behavioral tests for the chat-mode <PapersInContextSidebar>.
 *
 * Locks the contract that this component shares the same visual shell
 * as <BucketSidebar> (motion.aside + collapse + sliver), without the
 * bucket-specific affordances (no remove buttons on rows, no Clear-all
 * footer, no capacity meter).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useChatPapersSidebarStore } from "@/lib/store";
import { PapersInContextSidebar } from "@/components/extraction/chat/papers-in-context-sidebar";
import type { Id } from "@/convex/_generated/dataModel";

let mockSources:
  | undefined
  | {
      status: "ok" | "denied";
      sources: Array<{
        _id: string;
        title: string;
        authors: string[];
        year?: number;
        source: "history" | "library" | "collection" | "zotero" | "upload";
      }>;
    };

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("convex/react", () => ({
  useQuery: () => mockSources,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    extraction: {
      queries: { getJobSources: "stub" },
    },
  },
}));

function setMobileMatchMedia(isMobile: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: isMobile && query.includes("max-width: 767px"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

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

beforeEach(() => {
  setMobileMatchMedia(false);
  window.localStorage.clear();
  useChatPapersSidebarStore.setState({
    isCollapsed: false,
    _hasHydrated: true,
  });
  mockSources = {
    status: "ok",
    sources: [
      {
        _id: "src_1",
        title: "Alpha Paper",
        authors: ["Ada"],
        year: 2024,
        source: "library",
      },
      {
        _id: "src_2",
        title: "Beta Paper",
        authors: ["Beth"],
        year: 2023,
        source: "zotero",
      },
    ],
  };
});

afterEach(() => {
  useChatPapersSidebarStore.setState({
    isCollapsed: false,
    _hasHydrated: true,
  });
});

const jobId = "job_1" as Id<"extractionJobs">;

function withProviders(ui: React.ReactElement) {
  return <TooltipProvider>{ui}</TooltipProvider>;
}

describe("<PapersInContextSidebar> mount", () => {
  it("desktop: mounts the shared shell as a complementary aside", () => {
    render(withProviders(<PapersInContextSidebar jobId={jobId} />));
    expect(screen.getByRole("complementary")).toBeTruthy();
    expect(document.querySelector('[data-sidebar-shell="true"]')).not.toBeNull();
  });

  it("mobile: returns the Sheet trigger instead of the shell", async () => {
    setMobileMatchMedia(true);
    render(withProviders(<PapersInContextSidebar jobId={jobId} />));
    await waitFor(() => {
      expect(
        document.querySelector('[data-sidebar-variant="mobile"]'),
      ).not.toBeNull();
    });
    expect(document.querySelector('[data-sidebar-shell="true"]')).toBeNull();
  });

  it("pre-hydration: returns null even on desktop", () => {
    useChatPapersSidebarStore.setState({ _hasHydrated: false });
    render(withProviders(<PapersInContextSidebar jobId={jobId} />));
    expect(screen.queryByRole("complementary")).toBeNull();
  });
});

describe("<PapersInContextSidebar> body + header", () => {
  it("renders all paper rows with their titles", () => {
    render(withProviders(<PapersInContextSidebar jobId={jobId} />));
    expect(screen.getByText("Alpha Paper")).toBeTruthy();
    expect(screen.getByText("Beta Paper")).toBeTruthy();
  });

  it("rows are read-only — no per-row remove button", () => {
    render(withProviders(<PapersInContextSidebar jobId={jobId} />));
    expect(screen.queryByRole("button", { name: /remove alpha/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /remove beta/i })).toBeNull();
    // The data-paper-readonly contract is set by BucketPaperRow.
    const items = document.querySelectorAll('[data-paper-source]');
    items.forEach((el) => {
      expect(el).toHaveAttribute("data-paper-readonly", "true");
    });
  });

  it("header shows the paper count badge", () => {
    render(withProviders(<PapersInContextSidebar jobId={jobId} />));
    const badge = document.querySelector("[data-paper-count]");
    expect(badge).toHaveAttribute("data-paper-count", "2");
    expect(badge).toHaveTextContent("2");
  });

  it("loading state shows the chatPreparing copy", () => {
    mockSources = undefined;
    render(withProviders(<PapersInContextSidebar jobId={jobId} />));
    expect(
      document.querySelector('[data-sidebar-state="loading"]'),
    ).toHaveTextContent("chatPreparing");
  });
});

describe("<PapersInContextSidebar> collapse control", () => {
  it("clicking the header collapse button collapses the sidebar", async () => {
    const user = userEvent.setup();
    render(withProviders(<PapersInContextSidebar jobId={jobId} />));
    await user.click(
      screen.getByRole("button", { name: /collapse papers sidebar/i }),
    );
    expect(useChatPapersSidebarStore.getState().isCollapsed).toBe(true);
  });

  it("sliver button expands a collapsed sidebar", async () => {
    const user = userEvent.setup();
    useChatPapersSidebarStore.setState({ isCollapsed: true });
    render(withProviders(<PapersInContextSidebar jobId={jobId} />));
    const sliver = screen.getByRole("button", { name: /open papers in context/i });
    await user.click(sliver);
    expect(useChatPapersSidebarStore.getState().isCollapsed).toBe(false);
  });

  it("⌘⇧P toggles collapse state", () => {
    render(withProviders(<PapersInContextSidebar jobId={jobId} />));
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "p",
          metaKey: true,
          shiftKey: true,
        }),
      );
    });
    expect(useChatPapersSidebarStore.getState().isCollapsed).toBe(true);
  });

  it("uses an INDEPENDENT collapse store from the bucket sidebar", () => {
    // Different localStorage key → a user can have one open and the
    // other collapsed without one fighting the other.
    expect(useChatPapersSidebarStore.persist.getOptions().name).toBe(
      "openalex-chat-papers-sidebar",
    );
  });
});

describe("<PapersInContextSidebar> bucket parity (negative space)", () => {
  it("does NOT render a Clear-all footer button (read-only)", () => {
    render(withProviders(<PapersInContextSidebar jobId={jobId} />));
    expect(screen.queryByRole("button", { name: /^clear all$/i })).toBeNull();
  });

  it("does NOT render the bucket capacity meter testid", () => {
    render(withProviders(<PapersInContextSidebar jobId={jobId} />));
    expect(screen.queryByTestId("bucket-sidebar-capacity")).toBeNull();
  });
});
