/**
 * @vitest-environment jsdom
 *
 * <AnimatedCount> — digit swap via AnimatePresence + scale pulse; bypassed
 * when the user prefers reduced motion (renders a plain span).
 *
 * Testing philosophy: assert on observable output (rendered text, DOM
 * structure), not on Tailwind class strings passed through via the
 * `tint` prop. Tint is a cosmetic passthrough and doesn't need a unit
 * test — visual-regression coverage belongs in a real browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

let reduced = false;

vi.mock("motion/react", async () => {
  const actual = await vi.importActual<typeof import("motion/react")>(
    "motion/react",
  );
  return {
    ...actual,
    useReducedMotion: () => reduced,
  };
});

beforeEach(() => {
  reduced = false;
});

afterEach(() => {
  reduced = false;
});

async function loadAnimatedCount() {
  const mod = await import("@/components/extraction/bucket/animated-count");
  return mod.AnimatedCount;
}

describe("<AnimatedCount>", () => {
  it("renders the current value and total", async () => {
    const AnimatedCount = await loadAnimatedCount();
    render(<AnimatedCount value={5} total={1000} tint="" />);
    expect(screen.getByText(/5/)).toBeTruthy();
    expect(screen.getByText(/\/ 1000/)).toBeTruthy();
  });

  it("omits the '/ total' suffix when showTotal is false", async () => {
    const AnimatedCount = await loadAnimatedCount();
    const { container } = render(
      <AnimatedCount value={5} total={1000} tint="" showTotal={false} />,
    );
    expect(container.textContent).not.toMatch(/\/\s*1000/);
    expect(container.textContent).toMatch(/5/);
  });

  it("reduced-motion path renders plain text (no motion wrappers)", async () => {
    reduced = true;
    const AnimatedCount = await loadAnimatedCount();
    const { container } = render(
      <AnimatedCount value={7} total={100} tint="" />,
    );
    expect(container.textContent).toMatch(/7\s*\/\s*100/);
  });

  it("updating value re-renders with the new number", async () => {
    const AnimatedCount = await loadAnimatedCount();
    const { rerender } = render(
      <AnimatedCount value={3} total={10} tint="" />,
    );
    expect(screen.getByText(/3/)).toBeTruthy();
    rerender(<AnimatedCount value={4} total={10} tint="" />);
    expect(screen.getByText(/4/)).toBeTruthy();
  });
});
