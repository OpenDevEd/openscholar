import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { REPORT_DEFAULTS } from "../../lib/reports/settings";
import { blankDetails, stageOf, type Metadata } from "../../lib/reports/report";
import { ensureWorkspace } from "../workspaces/create";
import { startsLeft } from "./limits";

const firstPage = { cursor: null, numItems: 10 };
const refused = (code: string) => ({ data: expect.objectContaining({ code }) });
const details = (title = "Shade trees and maize yields"): Metadata => ({ ...blankDetails("report.pdf", "2026-11-10"), title, abstract: "We measure maize yields on 640 plots." });
const passed = (checkId: string, pass = true, blocking = true) => ({ checkId, name: checkId, model: "typesafe/jev-1.13", pass, blocking });

/** Publishing switched on with Crossref's sandbox, an author, and an organisation with an admin and a member. */
async function setup({ humanReview = false } = {}) {
  const t = convexTest(schema);
  const seeded = await t.run(async (ctx) => {
    const person = (clerkId: string) => ctx.db.insert("users", { clerkId, email: `${clerkId}@test.local`, firstName: clerkId, state: "active" as const, createdAt: 1, updatedAt: 1 });
    const [authorId, adminId, memberId, strangerId] = await Promise.all(["author", "orgadmin", "member", "stranger"].map(person));
    const own = await ensureWorkspace(ctx, { kind: "personal", userId: authorId! });
    const organizationId = await ctx.db.insert("organizations", { clerkOrganizationId: "org_lab", name: "Learning Lab", slug: "lab", clerkCreatedAt: 1, clerkUpdatedAt: 1, state: "active", createdAt: 1, updatedAt: 1 });
    const lab = await ensureWorkspace(ctx, { kind: "organization", organizationId });
    for (const [clerkUserId, role] of [["author", "org:member"], ["orgadmin", "org:admin"], ["member", "org:member"]] as const) {
      await ctx.db.insert("organizationMemberships", { clerkMembershipId: `mem_${clerkUserId}`, organizationId, clerkUserId, role, state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1 });
    }
    await ctx.db.insert("reportSettings", {
      ...REPORT_DEFAULTS,
      enabled: true,
      humanReview,
      publication: { zenodo: { mode: "off", license: "cc-by-4.0", defaultIdentifierPolicy: "mint-zenodo" }, crossref: { mode: "sandbox", prefix: "10.53832", suffixNamespace: "openscholar-r", depositorName: "d", email: "d@test.local", registrant: "r" } },
      updatedAt: 1,
    });
    await ctx.db.insert("reportLimits", { workspaceId: lab, perDay: 5, updatedAt: 1, updatedBy: adminId! });
    return { authorId: authorId!, own, lab, strangerId: strangerId! };
  });
  const as = (subject: string) => t.withIdentity({ subject });
  return { t, ...seeded, author: as("author"), orgAdmin: as("orgadmin"), member: as("member"), stranger: as("stranger") };
}

type World = Awaited<ReturnType<typeof setup>>;
const sign = (who: World["author"], workspaceId: Id<"workspaces">) => who.mutation(api.reports.flow.sign, { workspaceId, name: "Ada Author", onBehalfOfAll: true, version: 1 });
const read = async (who: World["author"], workspaceId: Id<"workspaces">, key: string) => {
  const found = await who.query(api.reports.flow.get, { workspaceId, key });
  if (!found || !("report" in found)) throw new Error("not this workspace's report");
  return found.report;
};
const row = (t: World["t"], key: string) => t.run(async (ctx) => (await ctx.db.query("reports").withIndex("by_key", (q) => q.eq("key", key)).unique())!);

/** A report with a PDF attached and read, waiting at its details. */
async function atDetails(world: World, who = world.author, workspaceId = world.own) {
  const key = await sign(who, workspaceId);
  const file = await world.t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.7 a report"], { type: "application/pdf" })));
  expect(await who.mutation(api.reports.flow.attachPdf, { workspaceId, key, file, name: "report.pdf" })).toBeNull();
  const { _id: reportId, pdf } = await row(world.t, key);
  await world.t.mutation(internal.reports.readingState.finish, { reportId, at: pdf!.at, pages: 12, metadata: details(), read: true });
  return { key, reportId, pdfAt: pdf!.at };
}

/** That report with its checks run, each answering as given. */
async function checked(world: World, results: ReturnType<typeof passed>[], who = world.author, workspaceId = world.own) {
  const report = await atDetails(world, who, workspaceId);
  await who.mutation(internal.reports.checkRuns.start, { workspaceId, key: report.key, metadata: details(), runId: "run-1" });
  await world.t.mutation(internal.reports.checkRuns.finish, { reportId: report.reportId, runId: "run-1", results, version: 1 });
  return report;
}

describe("starting a report", () => {
  it("reserves a key and a DOI, and counts against the workspace's day", async () => {
    const world = await setup();
    const key = await sign(world.author, world.own);
    expect(key).toBe("R100001");
    expect(await read(world.author, world.own, key)).toMatchObject({ doi: "10.53832/openscholar-r.r100001", step: "doi", status: "draft", mine: true, signer: "Ada Author" });
    // A person's own workspace starts one a day; the organisation's count is its own.
    await expect(sign(world.author, world.own)).rejects.toMatchObject(refused("FORBIDDEN"));
    expect(await sign(world.author, world.lab)).toBe("R100002");
  });

  it("is refused while publishing is off, for an agreement that changed, and without a name", async () => {
    const world = await setup();
    await expect(world.author.mutation(api.reports.flow.sign, { workspaceId: world.own, name: "Ada", onBehalfOfAll: false, version: 7 })).rejects.toMatchObject(refused("CONFLICT"));
    await expect(world.author.mutation(api.reports.flow.sign, { workspaceId: world.own, name: "   ", onBehalfOfAll: false, version: 1 })).rejects.toMatchObject(refused("VALIDATION_ERROR"));
    await world.t.run(async (ctx) => ctx.db.patch("reportSettings", (await ctx.db.query("reportSettings").first())!._id, { enabled: false }));
    await expect(sign(world.author, world.own)).rejects.toMatchObject(refused("FEATURE_DISABLED"));
    // Nothing a refused signing asked for was kept or counted.
    expect(await world.t.run((ctx) => ctx.db.query("reports").take(5))).toHaveLength(0);
    expect(await world.t.run((ctx) => startsLeft(ctx, world.own, Date.now()))).toMatchObject({ left: 1 });
  });

  it("keeps a discarded report's start used", async () => {
    const world = await setup();
    const key = await sign(world.author, world.own);
    await world.author.mutation(api.reports.flow.discard, { workspaceId: world.own, key });
    expect(await world.author.query(api.reports.flow.get, { workspaceId: world.own, key })).toBeNull();
    await expect(sign(world.author, world.own)).rejects.toMatchObject(refused("FORBIDDEN"));
  });
});

describe("who works on a workspace's report", () => {
  it("lets every member see it, and only its owner and the workspace's admins change it", async () => {
    const world = await setup();
    const key = await sign(world.author, world.lab);
    expect(await read(world.member, world.lab, key)).toMatchObject({ mine: false });
    expect(await read(world.orgAdmin, world.lab, key)).toMatchObject({ mine: true });
    expect((await world.member.query(api.reports.flow.list, { workspaceId: world.lab, paginationOpts: firstPage })).page).toMatchObject([{ key, mine: false }]);
    await expect(world.member.mutation(api.reports.flow.discard, { workspaceId: world.lab, key })).rejects.toMatchObject(refused("FORBIDDEN"));
    await expect(world.member.mutation(api.reports.flow.startUpload, { workspaceId: world.lab, key })).rejects.toMatchObject(refused("FORBIDDEN"));
    await expect(world.member.mutation(internal.reports.checkRuns.start, { workspaceId: world.lab, key, metadata: details(), runId: "r" })).rejects.toMatchObject(refused("FORBIDDEN"));
    await world.orgAdmin.mutation(api.reports.flow.discard, { workspaceId: world.lab, key });
  });

  it("shows it to nobody outside the workspace, and names its workspace to a member who asks from another", async () => {
    const world = await setup();
    const key = await sign(world.author, world.lab);
    await expect(world.stranger.query(api.reports.flow.get, { workspaceId: world.lab, key })).rejects.toMatchObject(refused("NOT_FOUND"));
    // Asked from the author's own workspace, the organisation's report is named, not shown.
    expect(await world.author.query(api.reports.flow.get, { workspaceId: world.own, key })).toEqual({ elsewhere: world.lab });
    // A change sent to the wrong workspace is refused.
    await expect(world.author.mutation(api.reports.flow.discard, { workspaceId: world.own, key })).rejects.toMatchObject(refused("NOT_FOUND"));
  });
});

describe("a report's PDF", () => {
  it("takes only a PDF within its size, deleting anything else and saying why", async () => {
    const world = await setup();
    const key = await sign(world.author, world.own);
    const text = await world.t.run((ctx) => ctx.storage.store(new Blob(["notes"])));
    expect(await world.author.mutation(api.reports.flow.attachPdf, { workspaceId: world.own, key, file: text, name: "notes.txt" })).toBe("Choose a PDF.");
    expect(await world.t.run((ctx) => ctx.db.system.get(text))).toBeNull();
    const empty = await world.t.run((ctx) => ctx.storage.store(new Blob([])));
    expect(await world.author.mutation(api.reports.flow.attachPdf, { workspaceId: world.own, key, file: empty, name: "empty.pdf" })).toMatch(/empty/);
    expect(await read(world.author, world.own, key)).toMatchObject({ step: "doi" });
  });

  it("opens its details once read, and ignores the reading of a PDF since replaced", async () => {
    const world = await setup();
    const first = await atDetails(world);
    expect(await read(world.author, world.own, first.key)).toMatchObject({ step: "details", metadata: { title: "Shade trees and maize yields" }, pdf: { pages: 12 } });
    // A second PDF starts over: the first one's details are gone until the new one is read.
    await world.author.mutation(api.reports.flow.goTo, { workspaceId: world.own, key: first.key, step: "upload" });
    const file = await world.t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.7 a second report"])));
    await world.author.mutation(api.reports.flow.attachPdf, { workspaceId: world.own, key: first.key, file, name: "second.pdf" });
    const replaced = await read(world.author, world.own, first.key);
    expect(replaced.step).toBe("upload");
    expect(replaced.metadata).toBeUndefined();
    await world.t.mutation(internal.reports.readingState.finish, { reportId: first.reportId, at: first.pdfAt, pages: 12, metadata: details("The first PDF's title"), read: true });
    expect((await read(world.author, world.own, first.key)).step).toBe("upload");
  });

  it("says when it couldn't be opened, and when its details couldn't be read", async () => {
    const world = await setup();
    const { key, reportId, pdfAt } = await atDetails(world);
    await world.author.mutation(api.reports.flow.goTo, { workspaceId: world.own, key, step: "upload" });
    await world.t.mutation(internal.reports.readingState.finish, { reportId, at: pdfAt, read: false });
    expect(await read(world.author, world.own, key)).toMatchObject({ step: "upload", pdf: { trouble: "unopened" } });
    await world.t.mutation(internal.reports.readingState.finish, { reportId, at: pdfAt, pages: 3, metadata: details(), read: false });
    expect(await read(world.author, world.own, key)).toMatchObject({ step: "details", pdf: { trouble: "unread" } });
  });
});

describe("a report's checks", () => {
  it("make it ready when all pass, and wait for a reviewer exactly while review is on", async () => {
    const world = await setup({ humanReview: true });
    const { key } = await checked(world, [passed("byline"), passed("harm")]);
    const report = await read(world.author, world.own, key);
    expect(report).toMatchObject({ step: "done", status: "passed", results: [{ checkId: "byline", pass: true }, { checkId: "harm", pass: true }] });
    // An author's page never gets the model behind an answer.
    expect(report.results![0]).not.toHaveProperty("model");
    expect(stageOf(report, true)).toBe("review");
    // Nothing about review is kept on the report: switched off, the same report is ready.
    expect(stageOf(report, false)).toBe("ready");
    expect(await world.author.query(api.reports.flow.counts, { workspaceId: world.own })).toMatchObject({ review: 1, ready: 0, underWay: 1, only: key });
  });

  it("stop it when a blocking check fails, and flag it for a reviewer when another does", async () => {
    const world = await setup();
    const blocked = await checked(world, [passed("byline", false), passed("harm")]);
    expect(await read(world.author, world.own, blocked.key)).toMatchObject({ status: "failed" });
    const flagged = await checked(world, [passed("byline"), passed("published", false, false)], world.author, world.lab);
    const report = await read(world.author, world.lab, flagged.key);
    expect(report).toMatchObject({ status: "passed", flagged: true });
    expect(stageOf(report, false)).toBe("review");
  });

  it("save nothing from a run that a newer run or a new PDF replaced", async () => {
    const world = await setup();
    const { key, reportId } = await atDetails(world);
    await world.author.mutation(internal.reports.checkRuns.start, { workspaceId: world.own, key, metadata: details(), runId: "old" });
    await world.author.mutation(internal.reports.checkRuns.start, { workspaceId: world.own, key, metadata: details("Corrected title"), runId: "new" });
    await world.t.mutation(internal.reports.checkRuns.answer, { reportId, runId: "old", result: passed("byline", false) });
    await world.t.mutation(internal.reports.checkRuns.finish, { reportId, runId: "old", results: [passed("byline", false)], version: 1 });
    expect(await read(world.author, world.own, key)).toMatchObject({ step: "details", status: "draft", run: { results: [] }, metadata: { title: "Corrected title" } });
    await world.t.mutation(internal.reports.checkRuns.finish, { reportId, runId: "new", results: [passed("byline")], version: 1 });
    expect(await read(world.author, world.own, key)).toMatchObject({ step: "done", status: "passed" });
    // Checked, it takes no more runs, saves or uploads.
    await expect(world.author.mutation(internal.reports.checkRuns.start, { workspaceId: world.own, key, metadata: details(), runId: "late" })).rejects.toMatchObject(refused("CONFLICT"));
    await expect(world.author.mutation(api.reports.flow.startUpload, { workspaceId: world.own, key })).rejects.toMatchObject(refused("CONFLICT"));
    await world.author.mutation(api.reports.flow.saveDetails, { workspaceId: world.own, key, metadata: details("Changed after the checks") });
    expect((await read(world.author, world.own, key)).metadata?.title).toBe("Corrected title");
  });

  it("let a failed report ask for a person, go back for a new PDF, or be discarded", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline", false)]);
    await world.author.mutation(api.reports.flow.requestReview, { workspaceId: world.own, key, comment: "  The byline is on page 2.  " });
    expect(await read(world.author, world.own, key)).toMatchObject({ asked: true, reviewRequest: { comment: "The byline is on page 2." } });
    await world.author.mutation(api.reports.flow.goTo, { workspaceId: world.own, key, step: "upload" });
    expect(await read(world.author, world.own, key)).toMatchObject({ step: "upload", status: "failed" });
    await world.author.mutation(api.reports.flow.discard, { workspaceId: world.own, key });
    expect(await world.t.run((ctx) => ctx.db.query("reportDetails").take(5))).toHaveLength(0);
  });

  it("can't be asked about, sent back or discarded once it has passed", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    await expect(world.author.mutation(api.reports.flow.requestReview, { workspaceId: world.own, key, comment: "" })).rejects.toMatchObject(refused("CONFLICT"));
    await expect(world.author.mutation(api.reports.flow.goTo, { workspaceId: world.own, key, step: "upload" })).rejects.toMatchObject(refused("CONFLICT"));
    await expect(world.author.mutation(api.reports.flow.discard, { workspaceId: world.own, key })).rejects.toMatchObject(refused("CONFLICT"));
  });
});

describe("a workspace's list of reports", () => {
  it("pages the newest first and keeps one stage when asked", async () => {
    const world = await setup();
    const ready = await checked(world, [passed("byline")], world.author, world.lab);
    const failed = await checked(world, [passed("byline", false)], world.author, world.lab);
    const draft = await sign(world.author, world.lab);
    const all = await world.author.query(api.reports.flow.list, { workspaceId: world.lab, paginationOpts: firstPage });
    expect(all.page.map((r) => r.key)).toEqual([draft, failed.key, ready.key]);
    const only = await world.author.query(api.reports.flow.list, { workspaceId: world.lab, paginationOpts: firstPage, show: "failed" });
    expect(only.page.map((r) => r.key)).toEqual([failed.key]);
    expect(await world.author.query(api.reports.flow.counts, { workspaceId: world.lab })).toMatchObject({ all: 3, draft: 1, failed: 1, ready: 1, underWay: 3, only: null });
  });
});
