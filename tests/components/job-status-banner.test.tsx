/**
 * @vitest-environment jsdom
 *
 * Plan-06 behavior tests for <JobStatusBanner variant="paused">.
 *
 * creditsExhausted variant is covered by the existing
 * credits-exhausted-banner.test.tsx — that test exercises the same
 * component surface through the thin CreditsExhaustedBanner alias, so
 * we don't duplicate that coverage here.
 *
 * Per project CLAUDE.md testing doctrine: assert on role + data-* +
 * ARIA, never on Tailwind utility strings.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { JobStatusBanner } from "@/components/extraction/job-status-banner";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: () => ({ data: undefined }),
}));

describe("<JobStatusBanner variant='paused'>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("does NOT surface a credits-related badge (paused is not a credit state)", () => {
    render(
      <JobStatusBanner
        variant="paused"
        onResume={() => {}}
        processedPapers={10}
        totalPapers={20}
      />,
    );
    // No "Buy Credits" CTA.
    expect(
      screen.queryByRole("button", { name: /buyCredits/i }),
    ).toBeNull();
  });
});
