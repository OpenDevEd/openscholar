import type { Page, Locator } from "@playwright/test";

type PlanId = "free" | "go" | "pro" | "enterprise";

/**
 * Page Object Model for the pricing page (/pricing).
 * All selectors use data-testid attributes added in Plan 01.
 */
export class PricingPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Navigate to the pricing page and wait for plan cards to be visible.
   */
  async goto(): Promise<void> {
    await this.page.goto("/pricing");
    // Wait for at least one plan card to be visible
    await this.page.locator('[data-testid^="pricing-plan-"]').first().waitFor({
      state: "visible",
      timeout: 30_000,
    });
  }

  /**
   * Get the locator for a specific plan card.
   */
  planCard(planId: PlanId): Locator {
    return this.page.locator(`[data-testid="pricing-plan-${planId}"]`);
  }

  /**
   * Get the locator for a specific plan's action button.
   */
  planButton(planId: PlanId): Locator {
    return this.page.locator(`[data-testid="pricing-button-${planId}"]`);
  }

  /**
   * Click the subscribe/action button for a specific plan.
   */
  async clickSubscribe(planId: PlanId): Promise<void> {
    await this.planButton(planId).click();
  }

  /**
   * Get the text of a plan's action button (e.g., "Upgrade to Pro", "Current Plan").
   */
  async getButtonText(planId: PlanId): Promise<string> {
    return (await this.planButton(planId).textContent()) ?? "";
  }

  /**
   * Get the "Current Plan" badge locator.
   * Use with expect(pricingPage.currentBadge).toBeVisible() to check if a plan is current.
   */
  get currentBadge(): Locator {
    return this.page.locator('[data-testid="pricing-current-badge"]');
  }

  /**
   * Get the "Scheduled" badge locator.
   * Use with expect(pricingPage.scheduledBadge).toBeVisible() to check if a plan change is scheduled.
   */
  get scheduledBadge(): Locator {
    return this.page.locator('[data-testid="pricing-scheduled-badge"]');
  }

  /**
   * Get the upgrade confirmation dialog's confirm button locator.
   */
  get upgradeConfirmButton(): Locator {
    return this.page.locator('[data-testid="upgrade-confirm-button"]');
  }

  /**
   * Get the upgrade confirmation dialog's cancel button locator.
   */
  get upgradeCancelButton(): Locator {
    return this.page.locator('[data-testid="upgrade-cancel-button"]');
  }

  /**
   * Get the upgrade confirmation dialog's total charge locator.
   */
  get upgradeTotalCharge(): Locator {
    return this.page.locator('[data-testid="upgrade-total-charge"]');
  }
}
