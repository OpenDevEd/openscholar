/**
 * @vitest-environment jsdom
 *
 * Plan 04 axe audit for the toolbar + popover surfaces. Renders the
 * standalone TransactionsPanelToolbar inside a NuqsTestingAdapter and
 * opens the type filter popover, asserting zero axe violations on the
 * combined toolbar + popover content.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    dateTime: (d: Date) => d.toISOString().slice(0, 10),
    number: (n: number) => String(n),
  }),
}));

import { TransactionsPanelToolbar } from "@/components/billing/transactions/transactions-panel-toolbar";

expect.extend(toHaveNoViolations);

const AXE_OPTIONS = {
  rules: {
    "color-contrast": { enabled: false },
  },
};

function Region({ children }: { children: React.ReactNode }) {
  // Real usage mounts the toolbar inside the TransactionsPanel section
  // (role="region"). The standalone test wraps it equivalently so axe's
  // "region" landmark rule passes the same way it does in production.
  return (
    <section role="region" aria-label="Transactions">
      {children}
    </section>
  );
}

describe("transactions-toolbar axe", () => {
  it("zero violations on the toolbar in its closed state", async () => {
    const { container } = render(
      <Region>
        <NuqsTestingAdapter>
          <TransactionsPanelToolbar counts={{}} />
        </NuqsTestingAdapter>
      </Region>,
    );
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });

  it("zero violations on the toolbar with the type-filter popover open", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Region>
        <NuqsTestingAdapter>
          <TransactionsPanelToolbar
            counts={{
              "type:purchase": 14,
              "type:usage": 9,
              "type:grant": 0,
              "type:refund": 0,
              "type:expiry": 0,
            }}
          />
        </NuqsTestingAdapter>
      </Region>,
    );
    await user.click(
      container.querySelector(
        '[data-filter-multi-select="type"]',
      )! as HTMLElement,
    );
    await screen.findByRole("listbox");
    // Popover renders into a Portal at document.body — assert against
    // the whole DOM so the axe sweep covers the popover content too.
    expect(
      await axe(document.body, AXE_OPTIONS),
    ).toHaveNoViolations();
  });
});
