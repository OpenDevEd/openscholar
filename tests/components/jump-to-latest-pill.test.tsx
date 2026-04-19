/**
 * @vitest-environment jsdom
 *
 * Behavioral tests for <JumpToLatestPill>.
 *
 * Locks the contract:
 * - Renders only when the user has scrolled away from the bottom
 * - Click invokes scrollToBottom and clears any pending unread badge
 * - Messages arriving while scrolled-up accumulate into a badge
 * - Reaching the bottom (isAtBottom flips true) resets the badge
 *
 * `useStickToBottomContext` is the only library coupling — mocked
 * with a controllable shape so the suite doesn't need a real DOM
 * scroll container.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { JumpToLatestPill } from "@/components/extraction/chat/jump-to-latest-pill";

const stickyState = {
  isAtBottom: true,
  scrollToBottom: vi.fn(),
};

vi.mock("use-stick-to-bottom", () => ({
  useStickToBottomContext: () => stickyState,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: { count?: number }) => {
    if (key === "chatJumpToLatestWithCount" && params) {
      return `${params.count} new messages`;
    }
    return key;
  },
}));

function reset(state: Partial<typeof stickyState>) {
  Object.assign(stickyState, {
    isAtBottom: true,
    scrollToBottom: vi.fn(),
    ...state,
  });
}

describe("<JumpToLatestPill>", () => {
  it("does not render while the user is at the bottom", () => {
    reset({ isAtBottom: true });
    render(<JumpToLatestPill messageCount={5} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders a pill when the user is scrolled away", () => {
    reset({ isAtBottom: false });
    render(<JumpToLatestPill messageCount={5} />);
    expect(screen.getByRole("button")).toHaveAttribute(
      "data-action",
      "jump-to-latest",
    );
  });

  it("clicking the pill calls scrollToBottom", () => {
    const scrollToBottom = vi.fn();
    reset({ isAtBottom: false, scrollToBottom });
    render(<JumpToLatestPill messageCount={5} />);
    fireEvent.click(screen.getByRole("button"));
    expect(scrollToBottom).toHaveBeenCalledTimes(1);
  });

  it("messages arriving while scrolled-up bump the unread badge", () => {
    reset({ isAtBottom: false });
    const { rerender } = render(<JumpToLatestPill messageCount={5} />);
    // First render: count 5, no unread yet (lastSeen aligns to messageCount).
    expect(screen.getByRole("button")).not.toHaveAttribute(
      "data-unread-count",
    );

    rerender(<JumpToLatestPill messageCount={7} />);
    // Two new messages while scrolled away → badge shows 2 new.
    expect(screen.getByRole("button")).toHaveAttribute(
      "data-unread-count",
      "2",
    );
    expect(screen.getByTestId("jump-pill-count")).toHaveTextContent(
      /2 new messages/,
    );
  });

  it("reaching the bottom resets the badge then a new scroll-away starts fresh", async () => {
    reset({ isAtBottom: false });
    const { rerender } = render(<JumpToLatestPill messageCount={5} />);
    rerender(<JumpToLatestPill messageCount={9} />);
    expect(screen.getByRole("button")).toHaveAttribute(
      "data-unread-count",
      "4",
    );

    // Simulate user scrolling to bottom — AnimatePresence exits the
    // pill; wait for it to actually leave the DOM before continuing.
    act(() => {
      reset({ isAtBottom: true });
    });
    rerender(<JumpToLatestPill messageCount={9} />);
    await waitFor(() => {
      expect(screen.queryByRole("button")).toBeNull();
    });

    // Scrolling away again starts the count fresh (no stale 4).
    act(() => {
      reset({ isAtBottom: false });
    });
    rerender(<JumpToLatestPill messageCount={9} />);
    expect(screen.getByRole("button")).not.toHaveAttribute(
      "data-unread-count",
    );
  });
});
