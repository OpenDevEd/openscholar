import { test, expect, type Page } from "./test";
import { clerk } from "@clerk/testing/playwright";
import { ConvexHttpClient } from "convex/browser";
import { readFile } from "node:fs/promises";
import { api } from "../convex/_generated/api";

function getTestUserEmail() {
  const emailAddress = process.env.E2E_CLERK_USER_EMAIL;
  if (!emailAddress) {
    throw new Error("Missing E2E_CLERK_USER_EMAIL for auth E2E tests.");
  }
  return emailAddress;
}

async function signIn(page: Page) {
  const emailAddress = getTestUserEmail();
  await page.goto("/");
  await clerk.loaded({ page });
  await clerk.signIn({
    page,
    emailAddress,
  });
}

test("library year filtering can be enabled, edited, reopened and reset", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Library", exact: true }).click();
  const currentYear = new Date().getFullYear();
  await page.getByRole("button", { name: "Choose year range", exact: true }).click();
  const toggle = page.getByRole("switch", { name: "Filter by year range", exact: true });
  await toggle.check();
  await expect(toggle).toBeChecked();
  const inputs = page.getByRole("spinbutton");
  await expect(inputs).toHaveCount(2);
  await inputs.nth(0).fill("2000");
  await inputs.nth(0).press("Enter");
  await inputs.nth(1).fill("2010");
  await inputs.nth(1).press("Enter");
  await expect(page).toHaveURL(url => url.searchParams.get("yf") === "2000" && url.searchParams.get("yt") === "2010");
  await page.reload();
  await page.getByRole("button", { name: "2000 → 2010", exact: true }).click();
  await expect(toggle).toBeChecked();
  await expect(inputs.nth(0)).toHaveValue("2000");
  await expect(inputs.nth(1)).toHaveValue("2010");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(toggle).not.toBeChecked();
  await expect(page).toHaveURL(url => !url.searchParams.has("yf") && !url.searchParams.has("yt"));
  await page.getByRole("button", { name: "This Year", exact: true }).click();
  await expect(toggle).toBeChecked();
  await expect(inputs.nth(0)).toHaveValue(String(currentYear));
  await expect(inputs.nth(1)).toHaveValue(String(currentYear));
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page).toHaveURL(url => !url.searchParams.has("yf") && !url.searchParams.has("yt"));
  await page.getByRole("button", { name: "Choose year range", exact: true }).click();
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(inputs).toHaveCount(0);
  await expect(page).toHaveURL(url => !url.searchParams.has("yf") && !url.searchParams.has("yt"));
});

test("an imported search keeps its identity, filters and questions after reopen, reload and repeated upload", async ({ page }) => {
  await signIn(page);
  await page.goto("/history");
  await clerk.loaded({ page });
  await expect.poll(() => page.evaluate(() => Boolean(window.Clerk.session))).toBe(true);
  const { token, accountId } = await page.evaluate(async () => {
    const session = window.Clerk.session!;
    return { token: (await session.getToken({ template: "convex" }))!, accountId: session.user.id };
  });
  const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  client.setAuth(token);
  const exportId = `e2e-${crypto.randomUUID()}`;
  const id = `import:${exportId}`;
  const query = `"${exportId}, reading" AND\nتعليم`;
  const spec = { query, yearRange: [2020, 2025], filterType: "year", isYearRangeEnabled: true, openAccessOnly: true, workTypes: ["article", "preprint"], screeningQuestions: [{ question: "Randomized?" }] };
  const row = { format_version: 1, export_id: exportId, search_query: query, count: 0, field: "title", spec };
  const upload = async () => {
    await page.getByRole("button", { name: "Download as JSON", exact: true }).click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: "Upload JSON", exact: true }).click();
    await (await chooser).setFiles({ name: "search.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ format: "openscholar.searches", version: 1, searches: [row] })) });
  };
  const count = () => client.query(api.research.records.countSearches, { accountId });
  const before = await count();
  try {
    await upload();
    await expect.poll(count).toBe(before + 1);
    await page.getByRole("button", { name: query.replace(/\n/g, " "), exact: true }).click();
    await expect(page).toHaveURL(url => decodeURIComponent(url.pathname) === `/results/${id}`);
    await expect(page.getByPlaceholder("mindfulness AND (anxiety OR stress)", { exact: true })).toHaveValue(query.replace(/\n/g, " "));
    await expect(page.getByRole("switch", { name: "Open access works", exact: true })).toBeChecked();
    await page.reload();
    await expect(page.getByPlaceholder("mindfulness AND (anxiety OR stress)", { exact: true })).toHaveValue(query.replace(/\n/g, " "));
    expect(await count()).toBe(before + 1);
    expect(await client.query(api.research.records.getSearch, { accountId, id })).toMatchObject({ id, ...spec });
    await page.goto("/history");
    await upload();
    await expect(page.getByRole("button", { name: query.replace(/\n/g, " "), exact: true })).toHaveCount(1);
    await page.getByRole("button", { name: "Download as JSON", exact: true }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Download as JSON", exact: true }).click();
    const exported = JSON.parse(await readFile((await (await download).path())!, "utf8"));
    expect(exported.searches.filter((item: { export_id: string }) => item.export_id === id)).toEqual([expect.objectContaining({ search_query: query, spec: expect.objectContaining(spec) })]);
    expect(await count()).toBe(before + 1);
  } catch (error) {
    await test.info().attach("import state before cleanup", { body: JSON.stringify({ rows: await client.query(api.research.records.listedSearches, { accountId, text: exportId, sort: "recent", paginationOpts: { numItems: 20, cursor: null } }), browser: await page.evaluate(() => ({ local: localStorage.getItem("search-history-store"), text: document.body.innerText })) }), contentType: "application/json" });
    throw error;
  } finally {
    // Clean up only this test's search, including duplicates if reopening regresses.
    const rows = await client.query(api.research.records.listedSearches, { accountId, text: exportId, sort: "recent", paginationOpts: { numItems: 20, cursor: null } });
    for (const row of rows.page) await client.mutation(api.research.records.change, { accountId, requestId: crypto.randomUUID(), command: { kind: "deleteSearch", id: row.id } });
  }
});

test("a search delete confirmation refuses an account change without losing the search", async ({ page }) => {
  await signIn(page);
  await page.goto("/history");
  await clerk.loaded({ page });
  await expect.poll(() => page.evaluate(() => Boolean(window.Clerk.session))).toBe(true);
  const marker = `delete-account-change-${crypto.randomUUID()}`;
  const id = `import:${marker}`;
  const { token, accountId, sessionId } = await page.evaluate(async () => ({
    token: (await window.Clerk.session!.getToken({ template: "convex" }))!,
    accountId: window.Clerk.session!.user.id,
    sessionId: window.Clerk.session!.id,
  }));
  const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  client.setAuth(token);
  try {
    await page.getByRole("button", { name: "Download as JSON", exact: true }).click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: "Upload JSON", exact: true }).click();
    await (await chooser).setFiles({ name: "search.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify([{ format_version: 1, export_id: marker, search_query: marker, spec: { query: marker } }])) });
    await expect.poll(() => client.query(api.research.records.getSearch, { accountId, id })).toMatchObject({ id });
    await expect(page.getByRole("button", { name: marker, exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Search your history...", exact: true }).fill(marker);
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await page.evaluate(() => window.Clerk.setActive({ session: null }));
    await expect.poll(() => page.evaluate(() => window.Clerk.session)).toBeNull();
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("Your account changed. Try again.", { exact: true })).toBeVisible();
    await page.evaluate(session => window.Clerk.setActive({ session }), sessionId);
    client.setAuth((await page.evaluate(() => window.Clerk.session!.getToken({ template: "convex" })))!);
    expect(await client.query(api.research.records.getSearch, { accountId, id })).toMatchObject({ id, query: marker });
  } finally {
    await client.mutation(api.research.records.change, { accountId, requestId: crypto.randomUUID(), command: { kind: "deleteSearch", id } });
  }
});

for (const kind of ["history", "bookmarks"] as const) {
  test(`${kind} import refuses a file selected before the account changed`, async ({ page }) => {
    await page.goto(`/${kind}`);
    await clerk.loaded({ page });
    const marker = `account-change-${crypto.randomUUID()}`;
    const id = `import:${marker}`;
    const data = kind === "history"
      ? [{ format_version: 1, export_id: marker, search_query: marker, spec: { query: marker } }]
      : [{ name: marker, expansion: "education", createdAt: 1 }];
    await page.getByRole("button", { name: "Download as JSON", exact: true }).click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: "Upload JSON", exact: true }).click();
    const filePicker = await chooser;
    await clerk.signIn({ page, emailAddress: getTestUserEmail() });
    await expect(page.getByRole("button", { name: "Download as JSON", exact: true })).toBeEnabled();
    const { token, accountId } = await page.evaluate(async () => ({
      token: (await window.Clerk.session!.getToken({ template: "convex" }))!,
      accountId: window.Clerk.session!.user.id,
    }));
    const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    client.setAuth(token);
    try {
      await filePicker.setFiles({ name: "research.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) });
      await expect(page.getByText("Upload failed", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(marker);
      expect(await client.query(api.research.records.getSearch, { accountId, id })).toBeNull();
      expect((await client.query(api.research.records.shortcutsOf, { accountId, names: [marker] })).page).toEqual([]);
      await page.getByRole("button", { name: "Download as JSON", exact: true }).click();
      const retryPicker = page.waitForEvent("filechooser");
      await page.getByRole("menuitem", { name: "Upload JSON", exact: true }).click();
      await (await retryPicker).setFiles({ name: "research.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) });
      if (kind === "history") {
        await expect.poll(() => client.query(api.research.records.getSearch, { accountId, id })).toMatchObject({ id, query: marker });
      } else {
        await expect.poll(async () => (await client.query(api.research.records.shortcutsOf, { accountId, names: [marker] })).page).toEqual([expect.objectContaining({ shorthand: marker, expansion: "education" })]);
      }
    } finally {
      await client.mutation(api.research.records.change, { accountId, requestId: crypto.randomUUID(), command: { kind: "deleteSearch", id } });
      await client.mutation(api.research.records.change, { accountId, requestId: crypto.randomUUID(), command: { kind: "shortcut", shorthand: marker, value: null } });
    }
  });
}

test("sidebar links keep their names and a single keyboard stop when collapsed or expanded", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await clerk.loaded({ page });
  const expand = page.getByRole("button", { name: "Expand sidebar (Ctrl+B)", exact: true });
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  const home = page.getByRole("link", { name: "Home", exact: true });
  const library = page.getByRole("link", { name: "Library", exact: true });
  await expect(home).toHaveAttribute("aria-current", "page");
  await home.focus();
  await expect(page.getByRole("tooltip")).toContainText("Home");
  await page.keyboard.press("Tab");
  await expect(library).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Bookmarks", exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "Screening", exact: true })).toBeVisible();
  const language = page.getByRole("button", { name: /^Language:/ });
  await language.focus();
  await page.keyboard.press("Enter");
  await expect(language).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(language).toBeFocused();
  await expand.click();
  await expect(page.getByRole("button", { name: "Collapse sidebar (Ctrl+B)", exact: true })).toHaveAttribute("aria-expanded", "true");
  await home.focus();
  await page.keyboard.press("Tab");
  await expect(library).toBeFocused();
});

test("choosing History dismisses the mobile navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await clerk.loaded({ page });
  await page.getByRole("button", { name: "Expand panel", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await drawer.getByRole("link", { name: "History", exact: true }).click();
  await expect(page).toHaveURL(/\/history(?:\?|$)/);
  await expect(drawer).toHaveCount(0);
});

test.describe("clerk auth flows", () => {
  test("anonymous user is redirected from protected route to /sign-in", async ({
    page,
  }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("/sign-in and /sign-up stay public when anonymous", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page).toHaveURL(/\/sign-in/);

    await page.goto("/sign-up");
    await expect(page).toHaveURL(/\/sign-up/);
  });

  test("sign in allows access to protected routes", async ({ page }) => {
    await signIn(page);
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/settings/);
  });

  test("an owner can save and reopen essential library configuration", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/evidence-libraries/new");

    const libraryName = `E2E Library ${Date.now()}`;
    await page
      .getByRole("textbox", { name: "Name", exact: true })
      .fill(libraryName);
    // Reserve waits for the server's answer about the address.
    const reserveButton = page.getByRole("button", { name: "Reserve address" });
    await expect(reserveButton).toBeEnabled({ timeout: 30_000 });
    await reserveButton.click();
    // The address's own status: the assistant panel, when it's on, announces its own.
    await expect(page.getByRole("status").and(page.locator("[data-address-state]"))).toHaveAttribute(
      "data-address-state",
      "reserved",
    );
    await expect(
      page.getByRole("textbox", { name: "Public address" }),
    ).toHaveText(/-lib\./);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/evidence-libraries\/[^/]+\/configuration$/);
    const configurationUrl = page.url();

    const tagline = "Evidence that survives a reload";
    await page.getByLabel("Tagline").fill(tagline);
    const saveButton = page.getByRole("button", { name: "Save", exact: true });
    await saveButton.click();
    // The button reads "Saving" while the save runs and is disabled once nothing is left to save.
    await expect(saveButton).toBeDisabled();

    await page.goto("/settings");
    await page.goto(configurationUrl);
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
      libraryName,
    );
    await expect(page.getByLabel("Tagline")).toHaveValue(tagline);

    await page.goto(`${configurationUrl}?section=versions`);
    const versions = page.locator("#sec-versions");
    await expect(versions).toBeInViewport();
    await page.reload();
    await expect(versions).toBeInViewport();
    await page.getByRole("navigation", { name: "Configuration sections" })
      .getByRole("link", { name: /^Identity/ }).click();
    await expect(page.locator("#sec-identity")).toBeInViewport();
    await page.goto(`${configurationUrl}?section=team`);
    await expect(page.getByRole("button", { name: "Add member", exact: true })).toBeVisible();
    await expect(page.locator("#sec-team")).toBeInViewport();
  });

  test("sign out returns session to anonymous behavior", async ({ page }) => {
    await signIn(page);
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/settings/);
    await page.goto("/");
    await clerk.signOut({ page });

    await page.goto("/settings");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
