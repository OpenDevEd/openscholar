import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const flagState = { enabled: true };

vi.mock("@/lib/feature-flags/hook", () => ({
  useFeatureFlag: (name: string) =>
    name === "extraction.bucket_v2" ? flagState.enabled : true,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <span className={className}>{children}</span>
  ),
}));

vi.mock("lucide-react", () => ({
  Sparkles: () => <span data-testid="icon-sparkles" />,
}));

import { BucketGate } from "../components/extraction/bucket/bucket-gate";

describe("BucketGate", () => {
  beforeEach(() => {
    flagState.enabled = true;
  });

  it("renders children when extraction.bucket_v2 is enabled", () => {
    render(
      <BucketGate>
        <div data-testid="child">bucket ux</div>
      </BucketGate>,
    );
    expect(screen.getByTestId("child")).toBeTruthy();
    expect(screen.queryByTestId("bucket-rollout-notice")).toBeNull();
  });

  it("renders rollout notice and hides children when flag is disabled", () => {
    flagState.enabled = false;
    render(
      <BucketGate>
        <div data-testid="child">bucket ux</div>
      </BucketGate>,
    );
    expect(screen.queryByTestId("child")).toBeNull();
    expect(screen.getByTestId("bucket-rollout-notice")).toBeTruthy();
  });

  it("the registry default is enabled for free+", async () => {
    const { FLAG_REGISTRY } = await import("../lib/feature-flags/registry");
    expect(FLAG_REGISTRY["extraction.bucket_v2"]).toBeDefined();
    expect(FLAG_REGISTRY["extraction.bucket_v2"].enabled).toBe(true);
    expect(FLAG_REGISTRY["extraction.bucket_v2"].minimumTier).toBe(0);
  });
});
