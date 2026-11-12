import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { JEV_MODEL } from "../../lib/ai/decisions";
import { DAY_MS } from "../../lib/reports/settings";
import { ensureWorkspace } from "../workspaces/create";
import { countStart, startsLeft } from "./limits";

async function setup() {
  const t = convexTest(schema);
  const seeded = await t.run(async (ctx) => {
    const person = (clerkId: string, email: string) => ctx.db.insert("users", { clerkId, email, state: "active" as const, createdAt: 1, updatedAt: 1 });
    const adminId = await person("clerk_admin", "admin@test.local");
    const authorId = await person("clerk_author", "author@test.local");
    // Each account and organisation gets its workspace as it is made.
    const own = await ensureWorkspace(ctx, { kind: "personal", userId: authorId });
    const organizationId = await ctx.db.insert("organizations", { clerkOrganizationId: "org_lab", name: "Learning Lab", slug: "lab", clerkCreatedAt: 1, clerkUpdatedAt: 1, state: "active", createdAt: 1, updatedAt: 1 });
    const lab = await ensureWorkspace(ctx, { kind: "organization", organizationId });
    // A decision model, which a check can run on.
    const jev = await ctx.db.insert("models", { modelId: JEV_MODEL, name: "Jev", provider: "typesafe", inputPricePerMillion: 0.04, outputPricePerMillion: 0, isServed: false, costMarkup: 1, sortOrder: 0, syncedAt: 1, createdAt: 1, updatedAt: 1 });
    return { adminId, authorId, own, organizationId, lab, jev };
  });
  await t.mutation(internal.admins.mutations.grant, { email: "admin@test.local" });
  return { t, ...seeded, admin: t.withIdentity({ subject: "clerk_admin" }), author: t.withIdentity({ subject: "clerk_author" }) };
}

const check = (jev: Id<"models">) => ({ name: "Has a methods section", question: "Does the report describe its methods?", modelId: jev, threshold: 0.6, blocking: false, enabled: true });

describe("Openscholar Reports settings", () => {
  it("are an admin's alone to read and change", async () => {
    const { author, jev, t } = await setup();
    const refused = { data: expect.objectContaining({ code: "FORBIDDEN" }) };
    await expect(author.query(api.reports.settings.admin, {})).rejects.toMatchObject(refused);
    await expect(author.mutation(api.reports.settings.update, { enabled: true })).rejects.toMatchObject(refused);
    await expect(author.mutation(api.reports.settings.saveCheck, check(jev))).rejects.toMatchObject(refused);
    await expect(author.mutation(api.reports.settings.setAgreement, { text: "Mine now." })).rejects.toMatchObject(refused);
    // Nothing a refused person asked for was kept.
    expect(await t.run((ctx) => ctx.db.query("reportSettings").first())).toBeNull();
  });

  it("start switched off, with a person reviewing every report", async () => {
    const { admin } = await setup();
    expect(await admin.query(api.reports.settings.admin, {})).toMatchObject({ enabled: false, humanReview: true, checksVersion: 1, agreement: { version: 1 } });
  });

  it("change one part of the series without touching the others", async () => {
    const { admin } = await setup();
    await admin.mutation(api.reports.settings.update, { series: { name: "Working Reports" } });
    await admin.mutation(api.reports.settings.update, { series: { issn: "2049-3630" } });
    expect((await admin.query(api.reports.settings.admin, {})).series).toMatchObject({ name: "Working Reports", issn: "2049-3630" });
  });

  it("take an ISSN only when it is one, since it is printed on every report", async () => {
    const { admin } = await setup();
    for (const typed of ["garbage", "1234-5678", "20493630"]) await expect(admin.mutation(api.reports.settings.update, { series: { issn: typed } })).rejects.toMatchObject({ data: expect.objectContaining({ code: "VALIDATION_ERROR" }) });
    await admin.mutation(api.reports.settings.update, { series: { issn: " 2049-3630 " } });
    expect((await admin.query(api.reports.settings.admin, {})).series.issn).toBe("2049-3630");
    // Cleared again, the byline says pending.
    await admin.mutation(api.reports.settings.update, { series: { issn: "" } });
    expect((await admin.query(api.reports.settings.admin, {})).series.issn).toBe("");
  });

  it("keep each version of the checks, so a report can be read against the ones it ran", async () => {
    const { admin, jev, t } = await setup();
    const before = (await admin.query(api.reports.settings.admin, {})).checks;
    await admin.mutation(api.reports.settings.saveCheck, check(jev));
    const after = await admin.query(api.reports.settings.admin, {});
    expect(after.checksVersion).toBe(2);
    expect(after.checks.map((c) => c.name)).toEqual([...before.map((c) => c.name), "Has a methods section"]);
    const added = after.checks.at(-1)!;
    await admin.mutation(api.reports.settings.removeCheck, { id: added.id });
    const versions = await t.run((ctx) => ctx.db.query("reportCheckVersions").withIndex("by_version").take(10));
    expect(versions.map((v) => [v.version, v.checks.length])).toEqual([[1, before.length], [2, before.length + 1], [3, before.length]]);
  });

  it("keep the built-in check: switched off, never removed, and still built in after an edit", async () => {
    const { admin, jev } = await setup();
    const builtIn = (await admin.query(api.reports.settings.admin, {})).checks.find((c) => c.builtIn)!;
    await expect(admin.mutation(api.reports.settings.removeCheck, { id: builtIn.id })).rejects.toMatchObject({ data: expect.objectContaining({ code: "VALIDATION_ERROR" }) });
    await admin.mutation(api.reports.settings.saveCheck, { ...check(jev), id: builtIn.id, enabled: false });
    expect((await admin.query(api.reports.settings.admin, {})).checks.find((c) => c.id === builtIn.id)).toMatchObject({ builtIn: "already-published", enabled: false });
  });

  it("keep the agreement people signed when its text changes", async () => {
    const { admin, t } = await setup();
    const first = (await admin.query(api.reports.settings.admin, {})).agreement.text;
    await admin.mutation(api.reports.settings.setAgreement, { text: "  A shorter agreement.  " });
    expect((await admin.query(api.reports.settings.admin, {})).agreement).toMatchObject({ version: 2, text: "A shorter agreement." });
    const kept = await t.run((ctx) => ctx.db.query("reportAgreementVersions").withIndex("by_version").take(10));
    expect(kept.map((v) => [v.version, v.text])).toEqual([[1, first], [2, "A shorter agreement."]]);
  });
});

describe("a workspace's new reports a day", () => {
  /** Autumn's catalog as synced, its Free plan starting `perDay` reports a day, or setting no number with null. */
  const catalog = (perDay: number | null) => ({
    plans: [
      { id: "free", name: "Free", addOn: false, autoEnable: true, features: [], popular: false, limits: { reports_per_day: perDay } },
      { id: "free_organization", name: "Free", addOn: false, autoEnable: false, features: [], popular: false, limits: {} },
    ],
    features: [],
    syncedAt: 1,
  });

  it("are the plan's: each start counts for 24 hours, and the one past them is refused", async () => {
    const { t, own } = await setup();
    await t.run((ctx) => ctx.db.insert("billingCatalog", catalog(2)));
    await t.run((ctx) => countStart(ctx, own));
    await t.run((ctx) => countStart(ctx, own));
    await expect(t.run((ctx) => countStart(ctx, own))).rejects.toMatchObject({ data: expect.objectContaining({ code: "FORBIDDEN" }) });
    const [, last] = await t.run((ctx) => ctx.db.query("reportStarts").take(5));
    expect(await t.run((ctx) => startsLeft(ctx, own, last!.at))).toEqual({ kind: "personal", perDay: 2, left: 0 });
    // A day after the starts, they no longer count.
    expect(await t.run((ctx) => startsLeft(ctx, own, last!.at + DAY_MS))).toMatchObject({ left: 2 });
  });

  it("have no number on a plan that sets none", async () => {
    const { t, own, lab } = await setup();
    await t.run((ctx) => ctx.db.insert("billingCatalog", catalog(1)));
    expect(await t.run((ctx) => startsLeft(ctx, lab, 1))).toEqual({ kind: "organization", perDay: null, left: null });
    await t.run((ctx) => countStart(ctx, lab));
    await t.run((ctx) => countStart(ctx, lab));
    expect(await t.run((ctx) => startsLeft(ctx, own, 1))).toMatchObject({ perDay: 1 });
  });
});
