/**
 * @vitest-environment jsdom
 *
 * Behavioral test for the pre-first-token typing indicator.
 * - Exposes role=status + aria-live so screen readers hear it
 * - Has an a11y label so users know what's happening
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TypingDots } from "@/components/extraction/chat/typing-dots";

describe("<TypingDots>", () => {
  it("renders as a live region announcing the AI is generating", () => {
    render(<TypingDots />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-label", "Generating response");
    expect(status).toHaveAttribute("data-testid", "typing-dots");
  });
});
