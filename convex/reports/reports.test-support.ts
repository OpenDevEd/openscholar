// What the reports' tests share: publishing switched on, people in and out of an organisation, and a report taken
// to each step by the functions its pages call.
import { convexTest } from "convex-test";
import { expect } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { REPORT_DEFAULTS } from "../../lib/reports/settings";
import { blankDetails, type Metadata } from "../../lib/reports/report";
import { ensureWorkspace } from "../workspaces/create";
import { actorFor } from "../workspaces/actor";

export const refused = (code: string) => ({ data: expect.objectContaining({ code }) });
export const details = (title = "Shade trees and maize yields"): Metadata => ({ ...blankDetails("report.pdf", "2026-11-10"), title, abstract: "We measure maize yields on 640 plots." });
export const passed = (checkId: string, pass = true, blocking = true) => ({ checkId, name: checkId, model: "typesafe/jev-1.13", pass, blocking });

/** Publishing switched on with Crossref's sandbox, an author, and an organisation with an admin and a member. */
export async function setup({ humanReview = false } = {}) {
  const t = convexTest(schema);
  const seeded = await t.run(async (ctx) => {
    const person = (clerkId: string) => ctx.db.insert("users", { clerkId, email: `${clerkId}@test.local`, firstName: clerkId, state: "active" as const, createdAt: 1, updatedAt: 1 });
    const [authorId, adminId, memberId, strangerId] = await Promise.all(["author", "orgadmin", "member", "stranger"].map(person));
    await person("reviewer");
    const own = await ensureWorkspace(ctx, { kind: "personal", userId: authorId! });
    const organizationId = await ctx.db.insert("organizations", { clerkOrganizationId: "org_lab", name: "Learning Lab", slug: "lab", clerkCreatedAt: 1, clerkUpdatedAt: 1, state: "active", createdAt: 1, updatedAt: 1 });
    const lab = await ensureWorkspace(ctx, { kind: "organization", organizationId });
    for (const [clerkUserId, role] of [["author", "org:member"], ["orgadmin", "org:admin"], ["member", "org:member"]] as const) {
      await ctx.db.insert("organizationMemberships", { clerkMembershipId: `mem_${clerkUserId}`, organizationId, clerkUserId, role, state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 });
    }
    // As settingsRow makes it: the settings with the version of the checks a report records when it runs them.
    await ctx.db.insert("reportCheckVersions", { version: REPORT_DEFAULTS.checksVersion, checks: REPORT_DEFAULTS.checks });
    await ctx.db.insert("reportSettings", {
      ...REPORT_DEFAULTS,
      enabled: true,
      humanReview,
      publication: { zenodo: { mode: "off", license: "cc-by-4.0", defaultIdentifierPolicy: "mint-zenodo" }, crossref: { mode: "sandbox", prefix: "10.53832", suffixNamespace: "openscholar-r", depositorName: "d", email: "d@test.local", registrant: "r" } },
      updatedAt: 1,
    });
    // Autumn's catalog as synced: a person's own workspace starts a report a day on Free, an organisation's five.
    await ctx.db.insert("billingCatalog", {
      plans: [
        { id: "free", name: "Free", addOn: false, autoEnable: true, features: [], popular: false, limits: { reports_per_day: 1 } },
        { id: "free_organization", name: "Free", addOn: false, autoEnable: false, features: [], popular: false, limits: { reports_per_day: 5 } },
      ],
      features: [],
      syncedAt: 1,
    });
    return { authorId: authorId!, own, lab, strangerId: strangerId! };
  });
  // An Openscholar admin, who reviews.
  await t.mutation(internal.admins.mutations.grant, { email: "reviewer@test.local" });
  const as = (subject: string) => t.withIdentity({ subject });
  return { t, ...seeded, author: as("author"), orgAdmin: as("orgadmin"), member: as("member"), stranger: as("stranger"), reviewer: as("reviewer") };
}

export type World = Awaited<ReturnType<typeof setup>>;
export const sign = (who: World["author"], workspaceId: Id<"workspaces">) => who.mutation(api.reports.flow.sign, { workspaceId, name: "Ada Author", onBehalfOfAll: true, version: 1, licence: "CC BY 4.0" });
export const read = async (who: World["author"], workspaceId: Id<"workspaces">, key: string) => {
  const found = await who.query(api.reports.flow.get, { workspaceId, key });
  if (!found || !("report" in found)) throw new Error("not this workspace's report");
  return found.report;
};
export const row = (t: World["t"], key: string) => t.run(async (ctx) => (await ctx.db.query("reports").withIndex("by_key", (q) => q.eq("key", key)).unique())!);

/** A report with a PDF attached and read, waiting at its details. */
export async function atDetails(world: World, who = world.author, workspaceId = world.own) {
  const key = await sign(who, workspaceId);
  const file = await world.t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.7 a report"], { type: "application/pdf" })));
  expect(await who.mutation(api.reports.flow.attachPdf, { workspaceId, key, file, name: "report.pdf" })).toBeNull();
  const { _id: reportId, pdf } = await row(world.t, key);
  await world.t.mutation(internal.reports.readingState.finish, { reportId, at: pdf!.at, pages: 12, metadata: details() });
  return { key, reportId, pdfAt: pdf!.at };
}

/** That report with its checks run, each answering as given. */
export async function checked(world: World, results: ReturnType<typeof passed>[], who = world.author, workspaceId = world.own) {
  const report = await atDetails(world, who, workspaceId);
  await who.mutation(internal.reports.checkRuns.start, { workspaceId, key: report.key, metadata: details(), runId: "run-1", from: { pdfAt: report.pdfAt } });
  await world.t.mutation(internal.reports.checkRuns.finish, { reportId: report.reportId, runId: "run-1", results, version: 1 });
  return report;
}

/**
 * Activates a report as the person signed in as `as`, the way Activate does once the report's price is held in the
 * workspace's publication balance: it goes live, or is refused with why.
 */
export async function activate(world: World, key: string, { as = "author", workspaceId = world.own }: { as?: string; workspaceId?: Id<"workspaces"> } = {}) {
  const actor = await world.t.run(async (ctx) => actorFor(ctx, (await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", as)).unique())!, workspaceId));
  // As the action does: what's in the way refuses before anything is charged, and the activation is recorded first.
  await world.t.query(internal.reports.activation.prepare, { actor, key });
  const activationId = await world.t.mutation(internal.reports.activation.begin, { actor, key, payWith: "balance" });
  return world.t.mutation(internal.reports.activation.settleCharge, { activationId, outcome: { kind: "held", hold: `hold_${key}`, charge: { invoice: `in_${key}`, total: 5, currency: "usd" } } });
}

/** A report live in the author's own workspace, every check passed. In the organisation, its admin activates it. */
export async function live(world: World, who = world.author, workspaceId = world.own) {
  const report = await checked(world, [passed("byline"), passed("harm")], who, workspaceId);
  await activate(world, report.key, { as: workspaceId === world.own ? "author" : "orgadmin", workspaceId });
  return report;
}

/** Whether review is on, set as an admin sets it. */
export const setReview = (world: World, humanReview: boolean) => world.reviewer.mutation(api.reports.settings.update, { humanReview });
