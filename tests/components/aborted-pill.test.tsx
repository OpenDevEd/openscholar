/**
 * @vitest-environment jsdom
 *
 * B3 — <AbortedPill /> renders the semantic contract:
 *   - role="status" (polite announcement to screen readers)
 *   - visible, translated label
 *   - data-message-state="aborted" for test targeting
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AbortedPill } from "@/components/extraction/chat/aborted-pill";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    if (key === "chatAbortedPillLabel") return "Stopped by user";
    if (key === "chatAbortedPillAria") return "This response was stopped by the user";
    return key;
  },
}));

describe("<AbortedPill>", () => {
  it("exposes role=status, the translated label, and the data-message-state attribute", () => {
    render(<AbortedPill />);
    const pill = screen.getByRole("status");
    expect(pill).toHaveAttribute("data-message-state", "aborted");
    expect(pill).toHaveAttribute(
      "aria-label",
      "This response was stopped by the user",
    );
    expect(pill).toHaveTextContent(/stopped by user/i);
  });
});
