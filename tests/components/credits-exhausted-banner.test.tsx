/**
 * @vitest-environment jsdom
 *
 * Behavior tests for <CreditsExhaustedBanner>. Asserts on role=alert +
 * data-job-status contract; never on Tailwind utilities (per project
 * CLAUDE.md testing doctrine).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CreditsExhaustedBanner } from "@/components/extraction/credits-exhausted-banner";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Controllable useProtectedQuery mock: set balance per-test.
const balanceStore = { data: undefined as unknown };
vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: () => balanceStore,
}));

function setBalance(total: number, hasEnough: boolean, required: number) {
  balanceStore.data = {
    hasEnough,
    free: 0,
    paid: total,
    total,
    required,
    deficit: hasEnough ? 0 : required - total,
  };
}

describe("<CreditsExhaustedBanner>", () => {
  beforeEach(() => {
    pushMock.mockClear();
    balanceStore.data = undefined;
  });

  it("exposes role=alert and data-job-status=creditsExhausted (tests can assert on contract)", () => {
    setBalance(0, false, 1);
    render(<CreditsExhaustedBanner />);
    const banner = screen.getByRole("alert");
    expect(banner).toHaveAttribute("data-job-status", "creditsExhausted");
  });

  it("Buy Credits button navigates to /settings/billing#topup-section", () => {
    setBalance(0, false, 1);
    render(<CreditsExhaustedBanner />);
    fireEvent.click(screen.getByRole("button", { name: /buyCredits/i }));
    expect(pushMock).toHaveBeenCalledWith("/settings/billing#topup-section");
  });

  it("Resume button is disabled when no onResume handler is wired (pre-plan-06)", () => {
    setBalance(1_000_000, true, 1);
    render(<CreditsExhaustedBanner />);
    const resume = screen.getByRole("button", {
      name: /creditsExhausted.resume/i,
    });
    expect(resume).toBeDisabled();
    expect(resume).toHaveAttribute("data-action", "resume");
  });

  it("Resume button is disabled when the balance is below minCreditsToResume even with handler wired", () => {
    setBalance(0, false, 1);
    const onResume = vi.fn();
    render(<CreditsExhaustedBanner onResume={onResume} />);
    expect(
      screen.getByRole("button", { name: /creditsExhausted.resume/i }),
    ).toBeDisabled();
  });

  it("Resume button is enabled when balance is sufficient AND handler is wired", () => {
    setBalance(100, true, 1);
    const onResume = vi.fn();
    render(<CreditsExhaustedBanner onResume={onResume} />);
    const resume = screen.getByRole("button", {
      name: /creditsExhausted.resume/i,
    });
    expect(resume).not.toBeDisabled();
    fireEvent.click(resume);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("Cancel remaining button only renders when onCancelRemaining is passed", () => {
    setBalance(0, false, 1);
    const { rerender } = render(<CreditsExhaustedBanner />);
    expect(
      screen.queryByRole("button", { name: /cancelRemaining/i }),
    ).toBeNull();

    const onCancelRemaining = vi.fn();
    rerender(<CreditsExhaustedBanner onCancelRemaining={onCancelRemaining} />);
    const cancelBtn = screen.getByRole("button", {
      name: /cancelRemaining/i,
    });
    expect(cancelBtn).toHaveAttribute("data-action", "cancel-remaining");
    fireEvent.click(cancelBtn);
    expect(onCancelRemaining).toHaveBeenCalledTimes(1);
  });

  it("offers both ways on for a job that stopped at the credits it was allowed: carrying on, and a top-up if its figure was the whole balance", () => {
    setBalance(100, true, 1);
    const onResume = vi.fn();
    const { rerender } = render(<CreditsExhaustedBanner allowed={40} onResume={onResume} />);
    fireEvent.click(screen.getByRole("button", { name: /creditsExhausted.resume/i }));
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /buyCredits/i })).toBeInTheDocument();

    setBalance(0, false, 1);
    rerender(<CreditsExhaustedBanner allowed={40} onResume={onResume} />);
    expect(screen.getByRole("button", { name: /creditsExhausted.resume/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /buyCredits/i })).toBeInTheDocument();
  });
});
