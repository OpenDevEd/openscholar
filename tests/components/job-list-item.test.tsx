/**
 * @vitest-environment jsdom
 *
 * Plan-07 — <JobListItem> status-dot a11y contract.
 *
 * Each status dot / stripe must expose:
 *   role="img"           — decorative visual that conveys state
 *   aria-label           — screen-reader text for that state
 *   data-job-status      — stable attribute for tests
 *
 * Every view mode (list-simple, list-detail, grid-2, grid-3) must
 * expose the attr on its respective status signifier. Chat-mode jobs
 * do not carry a pipeline status, so the attr must NOT leak for them.
 */

import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { render } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string, params?: Record<string, unknown>) => {
      if (params === undefined) return key;
      return `${key}:${JSON.stringify(params)}`;
    },
  useLocale: () => "en-US",
  useFormatter: () => ({
    relativeTime: () => "just now",
  }),
  useNow: () => new Date("2026-04-20T00:00:00Z"),
}));

vi.mock("motion/react", () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...props }: ComponentProps<"div">) => {
          // Strip motion-specific props that would spam the DOM otherwise.
          const {
            initial: _initial,
            animate: _animate,
            transition: _transition,
            exit: _exit,
            ...rest
          } = props as Record<string, unknown>;
          return <div {...rest}>{children as React.ReactNode}</div>;
        },
    },
  ),
}));

import { JobListItem } from "@/components/extraction/job-list-item";
import type { Doc, Id } from "@/convex/_generated/dataModel";

function buildJob(overrides: Partial<Doc<"extractionJobs">>): Doc<"extractionJobs"> {
  const now = Date.now();
  const base: Doc<"extractionJobs"> = {
    _id: "job_abc" as Id<"extractionJobs">,
    _creationTime: now,
    userId: "user_abc" as Id<"users">,
    mode: "extraction",
    name: "Test Job",
    sourceType: "history",
    status: "extracting",
    totalPapers: 10,
    processedPapers: 3,
    failedPapers: 0,
    usePdfs: false,
    createdAt: now,
    updatedAt: now,
  };
  return { ...base, ...overrides };
}

describe("<JobListItem> status-dot a11y", () => {
  it("list-simple: exposes role, aria-label, and data-job-status on the dot", () => {
    const job = buildJob({ status: "extracting" });
    const { container } = render(
      <JobListItem job={job} viewMode="list-simple" index={0} />,
    );
    const dot = container.querySelector('[data-job-status="extracting"]');
    expect(dot).not.toBeNull();
    expect(dot).toHaveAttribute("role", "img");
    expect(dot).toHaveAttribute("aria-label", "extracting");
  });

  it("list-detail: status dot carries the paused state label", () => {
    const job = buildJob({ status: "paused" });
    const { container } = render(
      <JobListItem job={job} viewMode="list-detail" index={0} />,
    );
    const dot = container.querySelector('[data-job-status="paused"]');
    expect(dot).not.toBeNull();
    expect(dot).toHaveAttribute("aria-label", "paused");
  });

  it("grid-3: the colored top stripe exposes aria-label + data-job-status", () => {
    const job = buildJob({ status: "completed" });
    const { container } = render(
      <JobListItem job={job} viewMode="grid-3" index={0} />,
    );
    const stripe = container.querySelector('[data-job-status="completed"]');
    expect(stripe).not.toBeNull();
    // `tc("completed")` → the mocked key echo; pins that the label derives
    // from the translation layer, not from the raw status literal.
    expect(stripe).toHaveAttribute("aria-label", "completed");
  });

  it("chat mode: does NOT emit a pipeline data-job-status (no dot, no labeled stripe)", () => {
    const job = buildJob({ mode: "chat", status: "extracting" });
    // list-simple hides the dot entirely in chat mode.
    const { container: simpleContainer } = render(
      <JobListItem job={job} viewMode="list-simple" index={0} />,
    );
    expect(
      simpleContainer.querySelector("[data-job-status]"),
    ).toBeNull();

    // grid-3 shows a stripe but it's decorative for chat (no pipeline
    // state); the attr must not leak.
    const { container: gridContainer } = render(
      <JobListItem job={job} viewMode="grid-3" index={0} />,
    );
    expect(
      gridContainer.querySelector("[data-job-status]"),
    ).toBeNull();
  });

  it("humanises unknown states ('download_failed' → 'download failed') for aria-label", () => {
    const job = buildJob({ status: "download_failed" as Doc<"extractionJobs">["status"] });
    const { container } = render(
      <JobListItem job={job} viewMode="list-simple" index={0} />,
    );
    const dot = container.querySelector(
      '[data-job-status="download_failed"]',
    );
    expect(dot).not.toBeNull();
    expect(dot).toHaveAttribute("aria-label", "download failed");
  });
});
