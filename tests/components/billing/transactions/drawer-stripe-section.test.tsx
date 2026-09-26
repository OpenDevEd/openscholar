/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, act } from "@testing-library/react";
import { renderWithTooltip as render } from "../../../helpers/render-with-tooltip";

import { DrawerStripeSection } from "@/components/billing/transactions/drawer-stripe-section";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

function setupClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

describe("DrawerStripeSection", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("renders the section heading and aria-labelledby link", () => {
    const { container } = render(
      <DrawerStripeSection
        invoiceId="in_abc"
        paymentIntentId={null}
        chargeId={null}
        checkoutSessionId={null}
      />,
    );
    const section = container.querySelector("[data-drawer-section='stripe']");
    expect(section?.getAttribute("aria-labelledby")).toBe(
      "drawer-stripe-heading",
    );
    expect(
      container.querySelector("#drawer-stripe-heading"),
    ).not.toBeNull();
  });

  it("renders only rows whose id is non-null", () => {
    const { container } = render(
      <DrawerStripeSection
        invoiceId="in_abc"
        paymentIntentId={null}
        chargeId="ch_123"
        checkoutSessionId={null}
      />,
    );
    expect(
      container.querySelector("[data-stripe-field='invoice']"),
    ).not.toBeNull();
    expect(container.querySelector("[data-stripe-field='pi']")).toBeNull();
    expect(
      container.querySelector("[data-stripe-field='charge']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-stripe-field='checkout']"),
    ).toBeNull();
  });

  it("links each stripe id to the matching Stripe dashboard path", () => {
    const { container } = render(
      <DrawerStripeSection
        invoiceId="in_abc"
        paymentIntentId="pi_xyz"
        chargeId="ch_123"
        checkoutSessionId={null}
      />,
    );
    const invoiceLink = container.querySelector(
      "[data-stripe-link='invoice']",
    ) as HTMLAnchorElement;
    const piLink = container.querySelector(
      "[data-stripe-link='pi']",
    ) as HTMLAnchorElement;
    const chargeLink = container.querySelector(
      "[data-stripe-link='charge']",
    ) as HTMLAnchorElement;
    expect(invoiceLink.href).toBe(
      "https://dashboard.stripe.com/invoices/in_abc",
    );
    expect(piLink.href).toBe("https://dashboard.stripe.com/payments/pi_xyz");
    expect(chargeLink.href).toBe(
      "https://dashboard.stripe.com/payments/ch_123",
    );
    for (const link of [invoiceLink, piLink, chargeLink]) {
      expect(link.target).toBe("_blank");
      expect(link.rel).toContain("noopener");
      expect(link.rel).toContain("noreferrer");
    }
  });

  it("omits the external link button for checkout sessions", () => {
    const { container } = render(
      <DrawerStripeSection
        invoiceId={null}
        paymentIntentId={null}
        chargeId={null}
        checkoutSessionId="cs_abc"
      />,
    );
    expect(
      container.querySelector("[data-stripe-field='checkout']"),
    ).not.toBeNull();
    expect(container.querySelector("[data-stripe-link='checkout']")).toBeNull();
  });

  it("copies the value and toggles data-stripe-copied for 1.5s", async () => {
    vi.useFakeTimers();
    const writeText = setupClipboard();
    const { container } = render(
      <DrawerStripeSection
        invoiceId="in_abc"
        paymentIntentId={null}
        chargeId={null}
        checkoutSessionId={null}
      />,
    );
    const copyBtn = container.querySelector(
      "[data-stripe-copy='invoice']",
    ) as HTMLElement;
    expect(copyBtn.getAttribute("data-stripe-copied")).toBeNull();

    await act(async () => {
      fireEvent.click(copyBtn);
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith("in_abc");
    expect(copyBtn.getAttribute("data-stripe-copied")).toBe("true");

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(copyBtn.getAttribute("data-stripe-copied")).toBeNull();
  });

  it("renders the receipt download anchor only when invoiceId is set", () => {
    const { container, rerender } = render(
      <DrawerStripeSection
        invoiceId={null}
        paymentIntentId="pi_xyz"
        chargeId={null}
        checkoutSessionId={null}
      />,
    );
    expect(container.querySelector("[data-drawer-receipt-download]")).toBeNull();

    rerender(
      <DrawerStripeSection
        invoiceId="in_abc"
        paymentIntentId="pi_xyz"
        chargeId={null}
        checkoutSessionId={null}
      />,
    );
    const receipt = container.querySelector(
      "[data-drawer-receipt-download]",
    ) as HTMLAnchorElement;
    expect(receipt).not.toBeNull();
    expect(receipt.getAttribute("href")).toBe(
      "https://dashboard.stripe.com/invoices/in_abc?print=true",
    );
  });
});
