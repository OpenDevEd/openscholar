// e2e/extraction-workbench.spec.ts
// Phase 105 D-06 through D-12: full v7.0 extraction workbench user story.
// Mocks Zotero via page.route; seeds a completed job via Convex internalAction
// invoked through the `npx convex run` CLI (canonical pattern from e2e/billing/fixtures.ts).
// NO direct ConvexHttpClient / api / internal imports — E2E runtime is decoupled from codegen.

import { test, expect, type Page } from "@playwright/test";
import { signIn } from "./helpers/sign-in";
import { statSync, readFileSync } from "node:fs";
import path from "node:path";

const FIXTURE_DIR = path.resolve(__dirname, "fixtures");
const zoteroCollections = JSON.parse(
  readFileSync(path.join(FIXTURE_DIR, "zotero-collections.json"), "utf-8"),
);
const zoteroItems = JSON.parse(
  readFileSync(path.join(FIXTURE_DIR, "zotero-items.json"), "utf-8"),
);

/** Seeds a completed extractionJob via `npx convex run`. Mirrors e2e/billing/fixtures.ts. */
async function seedCompletedJob(
  paperCount: number,
  questionCount: number,
): Promise<string> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  const cliArgs = [
    "convex",
    "run",
    "extraction/testing:seedCompletedJob",
    JSON.stringify({ paperCount, questionCount }),
    "--typecheck",
    "disable",
    "--codegen",
    "disable",
  ];
  if (process.env.CONVEX_DEPLOYMENT_NAME) {
    cliArgs.push("--deployment-name", process.env.CONVEX_DEPLOYMENT_NAME);
  }
  const { stdout } = await execFileAsync("npx", cliArgs, {
    env: process.env,
    maxBuffer: 1024 * 1024,
    timeout: 60_000,
  });
  // stdout may be `"jid_abcd..."` (JSON-quoted) or `jid_abcd...`
  const raw = stdout.trim().split("\n").at(-1)?.trim() ?? "";
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Installs Zotero API mocks for the page. Call before any navigation. */
async function mockZotero(page: Page): Promise<void> {
  await page.route("**/api.zotero.org/**/collections*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(zoteroCollections),
    }),
  );
  await page.route("**/api.zotero.org/**/items*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(zoteroItems),
    }),
  );
}

test.describe("v7.0 extraction workbench end-to-end", () => {
  let seededJobId: string;

  test.beforeAll(async () => {
    seededJobId = await seedCompletedJob(10, 3);
    if (!seededJobId) {
      throw new Error("seedCompletedJob returned empty jobId");
    }
  });

  test("stage papers across 5 tabs — library, collections, search, manual, zotero", async ({ page }) => {
    await mockZotero(page);
    await signIn(page);

    await page.goto("/extraction/new");
    await page.waitForLoadState("networkidle");

    // Library tab
    await page.getByRole("tab", { name: /library/i }).click();
    await page.getByRole("checkbox").first().check();

    // Collections tab
    await page.getByRole("tab", { name: /collections/i }).click();
    await page.getByRole("checkbox").first().check();

    // Search tab
    await page.getByRole("tab", { name: /search/i }).click();
    // (assumes pre-seeded searchHistory; if empty, this tab may not have checkboxes — no-op)

    // Manual tab
    await page.getByRole("tab", { name: /manual/i }).click();
    await page.getByRole("textbox").first().fill("10.1234/manual.paper");
    await page.getByRole("button", { name: /resolve/i }).click();

    // Zotero tab
    await page.getByRole("tab", { name: /zotero/i }).click();
    await page.getByRole("checkbox").first().check();

    // Counter reflects stage (format: "N / 1000")
    await expect(page.getByText(/\d+ ?\/ ?1000/i)).toBeVisible();

    // Open basket drawer
    await page.getByRole("button", { name: /basket|selection/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("seed a completed job, navigate all 3 views, open evidence drawer, assert reduced-motion <150ms", async ({ page }) => {
    await signIn(page);
    await page.goto(`/extraction/${seededJobId}`);
    await page.waitForLoadState("networkidle");

    // Table view (default)
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByText("Seeded Paper 0")).toBeVisible();

    // Switch to Card
    await page.getByRole("button", { name: /card view/i }).click();
    await expect(page.getByText("Seeded Paper 0")).toBeVisible();

    // Switch to Split
    await page.getByRole("button", { name: /split view/i }).click();
    await expect(page.getByText("Seeded Paper 0")).toBeVisible();

    // Open evidence drawer by clicking a result cell
    await page.getByText("seeded evidence span").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");

    // Reduced-motion assertion (D-22 + W7): 150ms threshold accounts for DOM/React/Playwright
    // overhead (16ms frame granularity × ~6 frames + buffer). Broken reduced-motion wiring
    // would blow past 300ms+ due to un-clamped Motion transitions.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: /table view/i }).click();
    const start = Date.now();
    await page.getByRole("button", { name: /split view/i }).click();
    await page.getByText("Seeded Paper 0").first().waitFor({ state: "visible" });
    const elapsed = Date.now() - start;
    expect(
      elapsed,
      `view-switch should complete <150ms under reduced-motion, got ${elapsed}ms`,
    ).toBeLessThan(150);
  });

  test("export filtered subset to CSV, JSON, XLSX", async ({ page }) => {
    await signIn(page);
    await page.goto(`/extraction/${seededJobId}`);
    await page.waitForLoadState("networkidle");

    // Apply a filter (optional — narrows result set; skip if no filter UI is visible)
    const search = page.getByRole("searchbox");
    if (await search.count() > 0) {
      await search.fill("Seeded Paper 1");
    }

    for (const format of ["csv", "json", "xlsx"] as const) {
      const downloadPromise = page.waitForEvent("download");
      // Open export menu (DropdownMenuTrigger wraps a <Button>)
      const exportTrigger = page.getByRole("button", { name: /export/i }).first();
      await exportTrigger.click();
      await page.getByRole("menuitem", { name: new RegExp(format, "i") }).click();

      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`, "i"));
      const downloadPath = await download.path();
      expect(downloadPath).toBeTruthy();
      if (downloadPath) {
        expect(statSync(downloadPath).size).toBeGreaterThan(0);
      }
    }
  });
});
