/**
 * @vitest-environment jsdom
 *
 * Plan-07 — <JobListItem> status-icon a11y contract.
 *
 * Each status icon must expose:
 *   role="img"           — decorative visual that conveys state
 *   aria-label           — screen-reader text for that state
 *   data-job-status      — stable attribute for tests
 *
 * Every view mode (list-simple, list-detail, grid-2, grid-3) must
 * expose the attr on its status icon. Chat-mode jobs do not carry a
 * pipeline status, so the attr must NOT leak for them.
 */

import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { renderWithTooltip as render } from "../helpers/render-with-tooltip";

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
    name: "Test Job",
    sourceType: "history",
    status: "extracting",
    totalPapers: 10,
    usePdfs: false,
    createdAt: now,
    updatedAt: now,
  };
  return { ...base, ...overrides };
}

describe("<JobListItem> status-icon a11y", () => {
  it("list-simple: exposes role, aria-label, and data-job-status on the status icon", () => {
    const job = buildJob({ status: "extracting" });
    const { container } = render(
      <JobListItem job={job} viewMode="list-simple" />,
    );
    const dot = container.querySelector('[data-job-status="extracting"]');
    expect(dot).not.toBeNull();
    expect(dot).toHaveAttribute("role", "img");
    expect(dot).toHaveAttribute("aria-label", "extracting");
  });

  it("humanises unknown states ('download_failed' → 'download failed') for aria-label", () => {
    const job = buildJob({ status: "download_failed" as Doc<"extractionJobs">["status"] });
    const { container } = render(
      <JobListItem job={job} viewMode="list-simple" />,
    );
    const dot = container.querySelector(
      '[data-job-status="download_failed"]',
    );
    expect(dot).not.toBeNull();
    expect(dot).toHaveAttribute("aria-label", "download failed");
  });
});
