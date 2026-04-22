/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const useOptionalAuthQueryMock = vi.fn();

vi.mock("@/lib/auth/use-auth-query", () => ({
  useOptionalAuthQuery: (...args: unknown[]) => useOptionalAuthQueryMock(...args),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    subscriptions: {
      queries: {
        getMy: "subscriptions:getMy",
      },
    },
  },
}));

import {
  SubscriptionStateProvider,
  useSubscriptionStateSelector,
} from "@/lib/auth/use-subscription-state";

function readyQueryResult() {
  return {
    data: {
      stripeSubscriptionId: "sub_123",
      stripeCustomerId: "cus_123",
      plan: "pro",
      status: "active",
    },
    settlement: "ready" as const,
    phase: "authenticated" as const,
    isDeferred: false,
    isReady: true,
    isAnonymous: false,
  };
}

function ResolvedPlanLabel() {
  const resolvedPlan = useSubscriptionStateSelector((state) => state.resolvedPlan);
  return <div data-testid="resolved-plan">{resolvedPlan ?? "none"}</div>;
}

function TierLabel() {
  const resolvedTier = useSubscriptionStateSelector((state) => state.resolvedTier);
  return <div data-testid="resolved-tier">{String(resolvedTier ?? "none")}</div>;
}

describe("<SubscriptionStateProvider>", () => {
  beforeEach(() => {
    useOptionalAuthQueryMock.mockReset();
    useOptionalAuthQueryMock.mockReturnValue(readyQueryResult());
  });

  it("shares one subscription query across selector consumers in the same subtree", () => {
    render(
      <SubscriptionStateProvider>
        <ResolvedPlanLabel />
        <TierLabel />
      </SubscriptionStateProvider>,
    );

    expect(useOptionalAuthQueryMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("resolved-plan")).toHaveTextContent("pro");
    expect(screen.getByTestId("resolved-tier")).toHaveTextContent("2");
  });
});
