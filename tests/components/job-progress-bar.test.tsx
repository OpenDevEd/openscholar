/**
 * @vitest-environment jsdom
 *
 * Plan-07 — a11y contract for <JobProgressBar>.
 *
 * Asserts on the progressbar role and aria-valuenow/min/max values
 * (the plan's explicit test plan). Never asserts on CSS classes.
 */

import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string, params?: Record<string, unknown>) => {
      if (params === undefined) return key;
      return `${key}:${JSON.stringify(params)}`;
    },
}));

vi.mock("motion/react", () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...props }: ComponentProps<"div">) => {
          const {
            initial: _i,
            animate: _a,
            transition: _t,
            ...rest
          } = props as Record<string, unknown>;
          return <div {...rest}>{children as React.ReactNode}</div>;
        },
    },
  ),
}));

import { JobProgressBar } from "@/components/extraction/job-progress-bar";

describe("<JobProgressBar>", () => {
  it("exposes role='progressbar' with aria-valuenow/min/max and aria-label", () => {
    render(
      <JobProgressBar
        jobName="Nightly extraction run"
        processed={47}
        failed={3}
        total={100}
      />,
    );
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-label", "Nightly extraction run");
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(bar).toHaveAttribute("data-progress-percent", "50");
  });

  it("floors percent at 0 when total is 0 (avoids NaN % and invalid aria-value)", () => {
    render(
      <JobProgressBar
        jobName="Empty job"
        processed={0}
        failed={0}
        total={0}
      />,
    );
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "0");
    expect(bar).toHaveAttribute("data-progress-percent", "0");
  });

  it("clamps percent at 100 when counters overshoot (finalize race guard)", () => {
    render(
      <JobProgressBar
        jobName="Overshoot job"
        processed={105}
        failed={0}
        total={100}
      />,
    );
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("data-progress-percent", "100");
  });

  it("aria-valuenow counts processed + failed (work is done either way)", () => {
    render(
      <JobProgressBar
        jobName="Mixed run"
        processed={30}
        failed={10}
        total={50}
      />,
    );
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "40");
    expect(bar).toHaveAttribute("data-progress-percent", "80");
  });

  it("aria-valuetext localizes the 'X / Y' caption for screen readers", () => {
    render(
      <JobProgressBar
        jobName="Run"
        processed={10}
        failed={0}
        total={100}
      />,
    );
    const bar = screen.getByRole("progressbar");
    // The mock passes params through in JSON form — we assert the
    // template key flows into aria-valuetext, pinning the contract.
    expect(bar.getAttribute("aria-valuetext")).toContain("progressOfPapers");
    expect(bar.getAttribute("aria-valuetext")).toContain("\"processed\":10");
    expect(bar.getAttribute("aria-valuetext")).toContain("\"total\":100");
  });
});
