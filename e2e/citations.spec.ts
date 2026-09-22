import { test, expect } from "@playwright/test";

test("copies the selected citation from every result-card layout", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const paperTitle = "Worms: Education and health externalities in kenya";
  await page.goto(`/results?q=${encodeURIComponent(paperTitle)}`);
  if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    await page.getByRole("button", { name: "Reject non-essential", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: new RegExp(paperTitle, "i") }).first()).toBeVisible();
  const resultsUrl = page.url();

  for (const layout of ["Detailed List", "Simple List", "2 Column Grid", "3 Column Grid"]) {
    await page.getByRole("button", { name: layout, exact: true }).click();
    await page.getByRole("button", { name: "Cite", exact: true }).first().click();
    const panel = page.getByRole("dialog");
    const text = panel.locator('[aria-live="polite"]');

    for (const style of ["APA 7", "BibTeX"]) {
      await panel.getByRole("button", { name: /^Citation style/ }).click();
      await page.getByRole("option", { name: style, exact: true }).click();
      await expect(panel).toHaveCount(1);
      const copy = panel.getByRole("button", { name: "Copy", exact: true });
      await expect(copy).toBeEnabled();
      const displayed = (await text.innerText()).trim();
      expect(displayed.replace(/[{}]/g, "").toLowerCase()).toContain(paperTitle.toLowerCase());
      if (style === "BibTeX") {
        expect(displayed).toMatch(/^@\w+\{os_W\d+,/);
      } else {
        expect(displayed).not.toMatch(/^@\w+\{/);
      }
      await page.evaluate(() => navigator.clipboard.writeText(""));
      await copy.click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(displayed);
    }

    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(page).toHaveURL(resultsUrl);
  }
});
