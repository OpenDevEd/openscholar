import type { Page, Locator } from "@playwright/test";

/**
 * Page Object Model for the billing settings page (/settings/billing).
 * All selectors use data-testid attributes added in Plan 01.
 */
export class BillingPage {
  readonly page: Page;

  // Locators (lazy, evaluated on access)
  readonly planName: Locator;
  readonly statusBadge: Locator;
  readonly renewalDate: Locator;
  readonly pendingChangeBanner: Locator;
  readonly keepPlanButton: Locator;
  readonly creditCapBanner: Locator;
  readonly manageButton: Locator;
  readonly creditBalance: Locator;
  readonly freeCredits: Locator;
  readonly paidCredits: Locator;

  constructor(page: Page) {
    this.page = page;
    this.planName = page.locator('[data-testid="billing-plan-name"]');
    this.statusBadge = page.locator('[data-testid="billing-status-badge"]');
    this.renewalDate = page.locator('[data-testid="billing-renewal-date"]');
    this.pendingChangeBanner = page.locator(
      '[data-testid="billing-pending-change-banner"]',
    );
    this.keepPlanButton = page.locator(
      '[data-testid="billing-keep-plan-button"]',
    );
    this.creditCapBanner = page.locator(
      '[data-testid="billing-credit-cap-banner"]',
    );
    this.manageButton = page.locator('[data-testid="billing-manage-button"]');
    this.creditBalance = page.locator('[data-testid="billing-credit-balance"]');
    this.freeCredits = page.locator('[data-testid="billing-free-credits"]');
    this.paidCredits = page.locator('[data-testid="billing-paid-credits"]');
  }

  /**
   * Navigate to the billing page and wait for the plan name to be visible.
   * This ensures the page has loaded and subscription state has settled.
   */
  async goto(): Promise<void> {
    await this.page.goto("/settings/billing");
    try {
      await this.planName.waitFor({ state: "visible", timeout: 30_000 });
    } catch (error) {
      const visibleText = await this.page
        .locator("body")
        .innerText()
        .catch(() => "");
      throw new Error(
        `Billing page did not become ready at ${this.page.url()}. Visible text: ${visibleText.slice(0, 2_000)}`,
        { cause: error },
      );
    }
  }

  /**
   * Get the displayed plan name (e.g., "Go Plan", "Pro Plan", "Free Plan").
   */
  async getPlanName(): Promise<string> {
    return (await this.planName.textContent()) ?? "";
  }

  /**
   * Get the subscription status badge text (e.g., "Active", "Inactive").
   */
  async getStatusBadgeText(): Promise<string> {
    return (await this.statusBadge.textContent()) ?? "";
  }

  /**
   * Get the renewal/expiry date text (e.g., "Renews on Mar 15, 2026").
   * Returns empty string if no renewal date is shown (free plan).
   */
  async getRenewalText(): Promise<string> {
    const count = await this.renewalDate.count();
    if (count === 0) return "";
    return (await this.renewalDate.textContent()) ?? "";
  }

  /**
   * Get the total credit balance as a number.
   * Strips non-digit characters (commas, spaces) and parses as integer.
   * Returns NaN if the element is not visible or text is not parseable.
   */
  async getCreditBalance(): Promise<number> {
    const count = await this.creditBalance.count();
    if (count === 0) return NaN;
    const text = (await this.creditBalance.textContent()) ?? "";
    return parseInt(text.replace(/[^0-9-]/g, ""), 10);
  }

  /**
   * Click the manage subscription / upgrade button.
   */
  async clickManageButton(): Promise<void> {
    await this.manageButton.click();
  }

  /**
   * Click the "Keep current plan" button to cancel a scheduled downgrade.
   */
  async clickKeepPlan(): Promise<void> {
    await this.keepPlanButton.click();
  }
}
