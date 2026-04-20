/**
 * @vitest-environment jsdom
 *
 * Plan-05 — behavior tests for <PermanentFailuresCallout>.
 *
 * Asserts on role=note + data-permanent-total + data-permanent-code
 * attributes so tests are decoupled from the localized label strings.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PermanentFailuresCallout } from "@/components/extraction/permanent-failures-callout";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

describe("<PermanentFailuresCallout>", () => {
  it("renders nothing when the breakdown is empty", () => {
    const { container } = render(
      <PermanentFailuresCallout breakdown={{}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("exposes role=note and data-permanent-total equal to the sum of counts", () => {
    render(
      <PermanentFailuresCallout
        breakdown={{ pdf_invalid: 2, moderation: 1 }}
      />,
    );
    const note = screen.getByRole("note");
    expect(note).toHaveAttribute("data-permanent-total", "3");
  });

  it("emits one <li> per code with data-permanent-code; iteration order follows the breakdown", () => {
    // summarizer returns insertion-ordered (count-desc, code-asc), so
    // tests pass the ordered map straight through.
    render(
      <PermanentFailuresCallout
        breakdown={{
          pdf_invalid: 3,
          moderation: 2,
          schema_validation: 1,
        }}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    const codes = items.map((el) =>
      el.getAttribute("data-permanent-code"),
    );
    expect(codes).toEqual(["pdf_invalid", "moderation", "schema_validation"]);
  });

  it("dismiss button hides the callout in-session", () => {
    render(
      <PermanentFailuresCallout breakdown={{ pdf_invalid: 1 }} />,
    );
    expect(screen.getByRole("note")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("renders an unknown-code row with data-permanent-code set to the raw string (forward-compat)", () => {
    render(
      <PermanentFailuresCallout
        breakdown={{ future_unseen_code: 2 }}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveAttribute(
      "data-permanent-code",
      "future_unseen_code",
    );
    // Label falls back to body.unknown; under the mock translator this
    // renders literally as "body.unknown".
    expect(items[0].textContent).toMatch(/body\.unknown/);
  });
});
