import { test, expect } from "./test";
import type { Work } from "@sickrin/openalex-sdk/dist/src/types/work";

const paperTitle = "Deterministic citation fixture for result cards";
const paper: Work = {
  id: "https://openalex.org/W9999999999",
  display_name: paperTitle,
  title: paperTitle,
  publication_year: 2024,
  publication_date: "2024-01-01",
  type: "article",
  authorships: [{ author: { id: "https://openalex.org/A9999999999", display_name: "Ada Example" } }],
  primary_location: { source: { id: "https://openalex.org/S9999999999", display_name: "Example Journal" } },
  biblio: { volume: "1", issue: "2", first_page: "3", last_page: "4" },
};

test("copies the selected citation from every result-card layout", async ({ page, context, next }) => {
  let servedServerSearch = false;
  next.onFetch((request) => {
    const url = new URL(request.url);
    if (url.hostname !== "api.openalex.org") return;
    if (url.pathname !== "/works") throw new Error(`Unexpected OpenAlex request: ${url.pathname}`);
    // Next adds this header to requests intercepted on the server.
    if (request.headers.has("next-test-stack")) servedServerSearch = true;
    return Response.json({
      meta: { count: 1, db_response_time_ms: 0, page: 1, per_page: 10, next_cursor: null },
      results: [paper],
      group_by: [],
    });
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/results?q=${encodeURIComponent(paperTitle)}`);
  if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    await page.getByRole("button", { name: "Reject non-essential", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: new RegExp(paperTitle, "i") }).first()).toBeVisible();
  expect(servedServerSearch, "the search must use the fixed server response").toBe(true);
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
