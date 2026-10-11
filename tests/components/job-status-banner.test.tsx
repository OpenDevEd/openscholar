/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { JobStatusBanner } from "@/components/extraction/job-status-banner";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("next-intl", () => ({
  useNow: () => new Date("2026-10-11T00:00:00Z"),
  useTranslations: () => (key: string) => key,
}));

// The person's balance, set per test.
const balanceStore = { data: undefined as unknown };
vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: () => balanceStore,
}));

function setBalance(total: number, hasEnough: boolean, required: number) {
  balanceStore.data = { hasEnough, free: 0, paid: total, total, required, deficit: hasEnough ? 0 : required - total };
}

describe("<JobStatusBanner variant='paused'>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    balanceStore.data = undefined;
  });

  it("exposes role='status' and data-job-status='paused' (screen-reader-stable contract)", () => {
    render(<JobStatusBanner variant="paused" onResume={() => {}} />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveAttribute("data-job-status", "paused");
  });

  it("announces changes politely via aria-live='polite'", () => {
    render(<JobStatusBanner variant="paused" onResume={() => {}} />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("renders a Resume button that fires onResume on click", () => {
    const onResume = vi.fn();
    render(<JobStatusBanner variant="paused" onResume={onResume} />);
    const resume = screen.getByRole("button", { name: /paused.resume/i });
    expect(resume).not.toBeDisabled();
    fireEvent.click(resume);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("Resume button is disabled when no onResume handler is wired", () => {
    render(<JobStatusBanner variant="paused" />);
    const resume = screen.getByRole("button", { name: /paused.resume/i });
    expect(resume).toBeDisabled();
  });

  it("cancel-remaining button only renders when onCancelRemaining is passed", () => {
    const { rerender } = render(
      <JobStatusBanner variant="paused" onResume={() => {}} />,
    );
    expect(
      screen.queryByRole("button", { name: /cancelRemaining/i }),
    ).toBeNull();

    const onCancelRemaining = vi.fn();
    rerender(
      <JobStatusBanner
        variant="paused"
        onResume={() => {}}
        onCancelRemaining={onCancelRemaining}
      />,
    );
    const cancelBtn = screen.getByRole("button", {
      name: /cancelRemaining/i,
    });
    expect(cancelBtn).toHaveAttribute("data-action", "cancel-remaining");
    fireEvent.click(cancelBtn);
    expect(onCancelRemaining).toHaveBeenCalledTimes(1);
  });
});

describe("<JobStatusBanner variant='creditsExhausted'>", () => {
  beforeEach(() => {
    pushMock.mockClear();
    balanceStore.data = undefined;
  });

  it("Buy Credits button navigates to /settings/billing#topup-section", () => {
    setBalance(0, false, 1);
    render(<JobStatusBanner variant="creditsExhausted" />);
    fireEvent.click(screen.getByRole("button", { name: /buyCredits/i }));
    expect(pushMock).toHaveBeenCalledWith("/settings/billing#topup-section");
  });

  it("Resume button is disabled when the balance is below minCreditsToResume even with handler wired", () => {
    setBalance(0, false, 1);
    render(<JobStatusBanner variant="creditsExhausted" onResume={vi.fn()} />);
    expect(screen.getByRole("button", { name: /creditsExhausted.resume/i })).toBeDisabled();
  });

  it("Resume button is enabled when balance is sufficient AND handler is wired", () => {
    setBalance(100, true, 1);
    const onResume = vi.fn();
    render(<JobStatusBanner variant="creditsExhausted" onResume={onResume} />);
    const resume = screen.getByRole("button", { name: /creditsExhausted.resume/i });
    expect(resume).not.toBeDisabled();
    fireEvent.click(resume);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("offers both ways on for a job that stopped at the credits it was allowed: carrying on, and a top-up if its figure was the whole balance", () => {
    setBalance(100, true, 1);
    const onResume = vi.fn();
    const { rerender } = render(<JobStatusBanner variant="creditsExhausted" allowed={40} onResume={onResume} />);
    fireEvent.click(screen.getByRole("button", { name: /creditsExhausted.resume/i }));
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /buyCredits/i })).toBeInTheDocument();

    setBalance(0, false, 1);
    rerender(<JobStatusBanner variant="creditsExhausted" allowed={40} onResume={onResume} />);
    expect(screen.getByRole("button", { name: /creditsExhausted.resume/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /buyCredits/i })).toBeInTheDocument();
  });
});
