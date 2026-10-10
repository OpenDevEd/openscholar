/**
 * @vitest-environment jsdom
 *
 * Focus mode keeps the paper open when the list it reads is reordered under it, as when the likely
 * order of a search's results arrives, and moves on from that paper.
 */
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { PaperResult } from "@/lib/types";

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "light", setTheme: vi.fn() }) }));
vi.mock("@/lib/hooks", () => ({ useIsMobile: () => false }));
vi.mock("@/components/paper-card", () => ({
  useTranslate: () => ({ translatedContent: null, showTranslated: false, isTranslating: false, setShowTranslated: vi.fn() }),
}));
vi.mock("@/components/paper-card/hooks", () => ({ useAuthorFilter: () => vi.fn() }));
vi.mock("@/components/library/save-control", () => ({ useSavePaper: () => ({ toggle: vi.fn(), saved: false }) }));
vi.mock("@/components/rating-selector", () => ({ useRatePaper: () => vi.fn() }));
vi.mock("@/components/focus-mode/paper-content", () => ({ PaperContent: () => null }));
vi.mock("@/components/focus-mode/focus-mode-settings", () => ({ FocusModeSettings: () => null }));
// The header shows which paper is open, and moves to the next one.
vi.mock("@/components/focus-mode/focus-mode-header", () => ({
  FocusModeHeader: ({ currentPaper, onGoToNext }: { currentPaper?: { id: string }; onGoToNext: () => void }) => (
    <div>
      <span data-testid="open-paper">{currentPaper?.id}</span>
      <button type="button" onClick={onGoToNext}>next</button>
    </div>
  ),
}));

import { FocusMode } from "@/components/ui/focus-mode";
import { openFocusMode } from "@/lib/search-actions";
import { useUIStore } from "@/lib/store";

const paper = (id: string) => ({ id }) as PaperResult;
const [a, b, c] = ["A", "B", "C"].map(paper);

function show(papers: PaperResult[]) {
  return <FocusMode isOpen onClose={vi.fn()} papers={papers} onDownloadItem={vi.fn()} onDownloadEssentialItem={vi.fn()} />;
}

beforeEach(() => {
  useUIStore.setState({ isFocusModeOpen: false, focusModeIndex: 0 });
});

describe("focus mode over a list reordered under it", () => {
  it("keeps the paper open, and goes on to the paper after it in the new order", () => {
    act(() => openFocusMode(false, 1, "B"));
    const { rerender } = render(show([a, b, c]));
    expect(screen.getByTestId("open-paper")).toHaveTextContent("B");
    // The likely order arrives: B first, then C and A.
    rerender(show([b, c, a]));
    expect(screen.getByTestId("open-paper")).toHaveTextContent("B");
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    expect(screen.getByTestId("open-paper")).toHaveTextContent("C");
  });

  it("opens at the place given when no paper is named, as before", () => {
    act(() => openFocusMode(false, 2));
    render(show([a, b, c]));
    expect(screen.getByTestId("open-paper")).toHaveTextContent("C");
  });
});
