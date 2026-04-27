/**
 * @vitest-environment jsdom
 *
 * plan-05 — covers the inline screening error alert. Asserts on
 * behavior contracts (ARIA role, data-error-code, data-action attrs,
 * retry callback) per the project testing doctrine — never on Tailwind
 * class strings.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ScreeningErrorAlert } from "@/components/screening/screening-error-alert";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) => {
    return namespace ? `${namespace}:${key}` : key;
  },
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("<ScreeningErrorAlert>", () => {
  it("returns null when no errors are passed", () => {
    const { container } = render(
      <ScreeningErrorAlert errors={[]} onRetry={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("emits data-error-code matching the worst envelope class (insufficient_credits beats unknown)", () => {
    render(
      <ScreeningErrorAlert
        errors={[
          { paperId: "p1", error: "INSUFFICIENT_CREDITS: ran out" },
          { paperId: "p2", error: "something else" },
        ]}
        onRetry={() => {}}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-error-code", "insufficient_credits");
    expect(alert).toHaveAttribute("data-screening-error", "true");
    expect(alert).toHaveAttribute("data-action", "retry-batch");
  });

  it("reads title + body from the shared errors.* namespace keyed on the envelope class", () => {
    render(
      <ScreeningErrorAlert
        errors={[
          { paperId: "p1", error: "INSUFFICIENT_CREDITS: top up" },
        ]}
        onRetry={() => {}}
      />,
    );
    expect(
      screen.getByText("errors:title.insufficient_credits"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("errors:body.insufficient_credits"),
    ).toBeInTheDocument();
  });

  it("renders a retry button that fires onRetry on click", () => {
    const onRetry = vi.fn();
    const { container } = render(
      <ScreeningErrorAlert
        errors={[{ paperId: "p1", error: "INSUFFICIENT_CREDITS: top up" }]}
        onRetry={onRetry}
      />,
    );
    const btn = container.querySelector(
      '[data-action="retry-batch-button"]',
    ) as HTMLButtonElement;
    expect(btn).not.toBeNull();
    fireEvent.click(btn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("hides the retry button when canRetry is false", () => {
    const { container } = render(
      <ScreeningErrorAlert
        errors={[{ paperId: "p1", error: "INSUFFICIENT_CREDITS: top up" }]}
        onRetry={() => {}}
        canRetry={false}
      />,
    );
    expect(
      container.querySelector('[data-action="retry-batch-button"]'),
    ).toBeNull();
  });

  it("renders an Open Billing link only for insufficient_credits envelopes", () => {
    const { container, rerender } = render(
      <ScreeningErrorAlert
        errors={[{ paperId: "p1", error: "INSUFFICIENT_CREDITS: top up" }]}
        onRetry={() => {}}
      />,
    );
    const link = container.querySelector(
      '[data-action="open-billing"]',
    ) as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.querySelector("a")?.getAttribute("href") ?? link.getAttribute("href")).toBe(
      "/settings/billing",
    );

    rerender(
      <ScreeningErrorAlert
        errors={[{ paperId: "p1", error: "some unknown failure" }]}
        onRetry={() => {}}
      />,
    );
    expect(
      container.querySelector('[data-action="open-billing"]'),
    ).toBeNull();
  });
});
