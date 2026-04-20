/**
 * @vitest-environment jsdom
 *
 * Behavior tests for <ExtractionPreflightBanner>. Asserts on ARIA roles
 * and data-preflight-ok — not on CSS utilities (per project CLAUDE.md
 * testing doctrine).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExtractionPreflightBanner } from "@/components/extraction/preflight-banner";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string, params?: Record<string, unknown>) => {
      if (params === undefined) return key;
      return `${key}:${JSON.stringify(params)}`;
    },
}));

describe("<ExtractionPreflightBanner>", () => {
  it("renders nothing when the estimate is zero (no questions or no papers)", () => {
    const { container } = render(
      <ExtractionPreflightBanner
        estimate={{ low: 0, mid: 0, high: 0 }}
        balance={{ hasEnough: true, total: 500, deficit: 0, required: 0 }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while the credits query is loading (balance undefined)", () => {
    const { container } = render(
      <ExtractionPreflightBanner
        estimate={{ low: 100, mid: 200, high: 300 }}
        balance={undefined}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("sufficient: data-preflight-ok=true, role=status, and no Buy Credits button", () => {
    render(
      <ExtractionPreflightBanner
        estimate={{ low: 100, mid: 200, high: 300 }}
        balance={{ hasEnough: true, total: 500, deficit: 0, required: 300 }}
      />,
    );
    const banner = screen.getByRole("status");
    expect(banner).toHaveAttribute("data-preflight-ok", "true");
    expect(screen.queryByRole("button", { name: /buyCredits/i })).toBeNull();
  });

  it("insufficient: data-preflight-ok=false, role=status, Buy Credits button present", () => {
    render(
      <ExtractionPreflightBanner
        estimate={{ low: 100, mid: 200, high: 300 }}
        balance={{ hasEnough: false, total: 50, deficit: 250, required: 300 }}
      />,
    );
    const banner = screen.getByRole("status");
    expect(banner).toHaveAttribute("data-preflight-ok", "false");
    expect(screen.getByRole("button", { name: /buyCredits/i })).toBeTruthy();
  });

  it("clicking Buy Credits routes to /settings/billing#topup-section and fires onBeforeNavigate", () => {
    pushMock.mockClear();
    const onBeforeNavigate = vi.fn();
    render(
      <ExtractionPreflightBanner
        estimate={{ low: 100, mid: 200, high: 300 }}
        balance={{ hasEnough: false, total: 50, deficit: 250, required: 300 }}
        onBeforeNavigate={onBeforeNavigate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /buyCredits/i }));
    expect(onBeforeNavigate).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith("/settings/billing#topup-section");
  });

  it("null balance (unauthenticated / query returns null) is treated as insufficient when estimate > 0", () => {
    render(
      <ExtractionPreflightBanner
        estimate={{ low: 100, mid: 200, high: 300 }}
        balance={null}
      />,
    );
    const banner = screen.getByRole("status");
    expect(banner).toHaveAttribute("data-preflight-ok", "false");
    expect(screen.getByRole("button", { name: /buyCredits/i })).toBeTruthy();
  });
});
