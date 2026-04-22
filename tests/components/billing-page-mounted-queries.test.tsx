/**
 * @vitest-environment jsdom
 */
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

const protectedQueryMock = vi.fn();
const useActionMock = vi.fn(() => vi.fn());
const routerReplaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: routerReplaceMock,
  }),
  useSearchParams: () => ({
    get: () => null,
    forEach: () => undefined,
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    dateTime: () => "formatted-date",
  }),
}));

vi.mock("convex/react", () => ({
  useAction: () => useActionMock(),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    credits: {
      queries: {
        getMyBalance: "credits:getMyBalance",
        getTopupCatalog: "credits:getTopupCatalog",
        getLatestGrantStatus: "credits:getLatestGrantStatus",
      },
      actions: {
        createTopupCheckoutSession: "credits:createTopupCheckoutSession",
      },
    },
    subscriptions: {
      actions: {
        createPortalSession: "subscriptions:createPortalSession",
        changePlan: "subscriptions:changePlan",
        getSubscriptionDetails: "subscriptions:getSubscriptionDetails",
      },
    },
  },
}));

vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: (queryRef: unknown, args: unknown) =>
    protectedQueryMock(queryRef, args),
}));

vi.mock("@/lib/auth/use-subscription-state", () => ({
  useSubscriptionState: () => ({
    subscription: null,
    resolvedPlan: "free",
    isEntitled: false,
    isSettling: false,
  }),
}));

vi.mock("@/lib/feature-flags/hook", () => ({
  useFeatureFlag: () => true,
}));

vi.mock("@/lib/toast", () => ({
  useAppToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
  },
}));

vi.mock("posthog-js", () => ({
  default: {
    capture: vi.fn(),
  },
}));

vi.mock("@/lib/toast/error-resolver", () => ({
  getToastMessageKeyForErrorCode: () => null,
}));

vi.mock("@/convex/lib/constants", () => ({
  getFreeCreditCapForPlan: () => 0,
}));

vi.mock("@/components/billing/credit-balance-card", () => ({
  CreditBalanceCard: () => <div data-testid="credit-balance-card" />,
}));

vi.mock("@/components/billing/credit-topup-card", () => ({
  CreditTopupCard: () => <div data-testid="credit-topup-card" />,
}));

vi.mock("@/components/billing/transactions/transactions-panel", () => ({
  TransactionsPanel: () => <div data-testid="transactions-panel" />,
}));

import BillingPage from "@/app/settings/billing/page";

describe("<BillingPage> mounted queries", () => {
  beforeEach(() => {
    protectedQueryMock.mockReset();
    useActionMock.mockClear();
    routerReplaceMock.mockClear();
    protectedQueryMock.mockReturnValue({ data: undefined });
  });

  it("mounts balance and topup queries without grant diagnostics", () => {
    render(<BillingPage />);

    const mountedQueryRefs = protectedQueryMock.mock.calls.map(([queryRef]) => queryRef);
    expect(mountedQueryRefs).toContain("credits:getMyBalance");
    expect(mountedQueryRefs).toContain("credits:getTopupCatalog");
    expect(mountedQueryRefs).not.toContain("credits:getLatestGrantStatus");
  });
});
