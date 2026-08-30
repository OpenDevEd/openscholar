import { test, expect } from "../fixtures";
import AxeBuilder from "@axe-core/playwright";

const DENSITIES = ["compact", "comfortable", "spacious"] as const;
const FILTERS = [
  { label: "none", query: "" },
  { label: "view=purchases", query: "?view=purchases" },
  { label: "search=abc", query: "?q=abc" },
  { label: "types=purchase,usage", query: "?types=purchase,usage" },
] as const;
const DRAWER_STATES = ["closed", "open"] as const;

/**
 * Plan-06 axe matrix:
 *   3 densities × 4 filter states × 2 drawer states = 24 combinations.
 *
 * Disabled rules (parity with the JSDOM axe suites):
 *   - color-contrast: chromium under playwright headless can flake on
 *     emulated theme paint; the unit-level axe specs already cover this
 *     in the design system, not in product code.
 *   - nested-interactive: TransactionRow nests an action <Link> inside
 *     a clickable row by design (escape-hatch click target).
 */
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const DISABLED_RULES = ["color-contrast", "nested-interactive"];

test.describe("Transactions panel — axe matrix", () => {
  for (const density of DENSITIES) {
    for (const filter of FILTERS) {
      for (const drawerState of DRAWER_STATES) {
        test(`${density} × ${filter.label} × drawer-${drawerState}`, async ({
          page,
          clerkUser: _clerkUser,
          billingPage,
        }) => {
          void _clerkUser;
          await billingPage.goto();
          await page.goto(`/settings/billing${filter.query}`);
          await page.waitForSelector("[data-transactions-panel]");

          // Apply density via the toolbar dropdown so the axe pass sees
          // the same DOM the user would.
          await page.locator("[data-transactions-density-trigger]").click();
          const densityOption = page.locator(
            `[data-density-option="${density}"]`,
          );
          await densityOption.click();
          await expect(densityOption).toBeHidden();
          await expect(
            page.locator(
              `[data-transactions-panel][data-transactions-density="${density}"]`,
            ),
          ).toBeVisible();

          if (drawerState === "open") {
            const firstRow = page.locator("[data-txn-row]").first();
            const rowCount = await page.locator("[data-txn-row]").count();
            test.skip(rowCount === 0, "no rows to open the drawer on");
            await firstRow.click();
            await expect(
              page.locator("[data-transaction-drawer]"),
            ).toBeVisible();
          }

          const builder = new AxeBuilder({ page })
            .withTags(AXE_TAGS)
            .disableRules(DISABLED_RULES)
            .include("[data-transactions-panel]");

          if (drawerState === "open") {
            builder.include("[data-transaction-drawer]");
          }

          const { violations } = await builder.analyze();
          expect(
            violations,
            `axe violations for ${density} × ${filter.label} × drawer-${drawerState}:\n${violations
              .map((v) => `  - ${v.id}: ${v.help}`)
              .join("\n")}`,
          ).toEqual([]);
        });
      }
    }
  }
});
