import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { REPORT_DEFAULTS } from "../../lib/reports/settings";
import { blankDetails, stageOf, type Metadata } from "../../lib/reports/report";
import { ensureWorkspace } from "../workspaces/create";
import { startsLeft } from "./limits";
import { sameTitle } from "./published";
import { purgeWorkspace } from "../workspaces/purge";

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
  await world.t.mutation(internal.reports.readingState.finish, { reportId, at: pdf!.at, pages: 12, metadata: details() });
  return { key, reportId, pdfAt: pdf!.at };
}

/** That report with its checks run, each answering as given. */
async function checked(world: World, results: ReturnType<typeof passed>[], who = world.author, workspaceId = world.own) {
  const report = await atDetails(world, who, workspaceId);
  await who.mutation(internal.reports.checkRuns.start, { workspaceId, key: report.key, metadata: details(), runId: "run-1", pdfAt: report.pdfAt });
  await world.t.mutation(internal.reports.checkRuns.finish, { reportId: report.reportId, runId: "run-1", results, version: 1 });
  return report;
}

describe("starting a report", () => {
  it("reserves a key and a DOI, and counts against the workspace's day", async () => {
    const world = await setup();
    const key = await sign(world.author, world.own);
    expect(key).toBe("R100001");
    expect(await read(world.author, world.own, key)).toMatchObject({ doi: "10.53832/openscholar-r.r100001", step: "doi", status: "draft", mine: true, signer: "Ada Author" });
    // Signing again before doing anything with it, as after a reload that lost the answer, gives the same report.
    expect(await sign(world.author, world.own)).toBe("R100001");
    expect(await world.author.query(api.reports.flow.starts, { workspaceId: world.own, now: Date.now() })).toMatchObject({ left: 0, untouched: "R100001" });
    // Once it has moved on, a person's own workspace starts no other that day; the organisation's count is its own.
    await world.author.mutation(api.reports.flow.goTo, { workspaceId: world.own, key, step: "upload" });
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
    expect((await world.member.query(api.reports.flow.page, { workspaceId: world.lab, page: 1 })).rows).toMatchObject([{ key, mine: false }]);
    await expect(world.member.mutation(api.reports.flow.discard, { workspaceId: world.lab, key })).rejects.toMatchObject(refused("FORBIDDEN"));
    await expect(world.member.mutation(api.reports.flow.startUpload, { workspaceId: world.lab, key })).rejects.toMatchObject(refused("FORBIDDEN"));
    await expect(world.member.mutation(internal.reports.checkRuns.start, { workspaceId: world.lab, key, metadata: details(), runId: "r", pdfAt: 1 })).rejects.toMatchObject(refused("FORBIDDEN"));
    await world.orgAdmin.mutation(api.reports.flow.discard, { workspaceId: world.lab, key });
  });

  it("shows it to nobody outside the workspace, and names its workspace to a member who asks from another", async () => {
    const world = await setup();
    const key = await sign(world.author, world.lab);
    await expect(world.stranger.query(api.reports.flow.get, { workspaceId: world.lab, key })).rejects.toMatchObject(refused("NOT_FOUND"));
    // Asked from the author's own workspace, the organisation's report is named, not shown.
    expect(await world.author.query(api.reports.flow.get, { workspaceId: world.own, key })).toEqual({ elsewhere: { name: "Learning Lab", slug: "lab" } });
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

  it("is never a file that isn't this upload's, and such a file is left alone", async () => {
    const world = await setup();
    const first = await atDetails(world);
    const firstPdf = (await row(world.t, first.key)).pdf!.file;
    // The first report's PDF, named again for a report in another workspace with a name that would be refused.
    const other = await sign(world.author, world.lab);
    expect(await world.author.mutation(api.reports.flow.attachPdf, { workspaceId: world.lab, key: other, file: firstPdf, name: "not-a-pdf.txt" })).toMatch(/didn't arrive/);
    expect(await world.t.run((ctx) => ctx.db.system.get(firstPdf))).not.toBeNull();
    expect((await read(world.author, world.own, first.key)).pdf?.url).toEqual(expect.any(String));
    expect((await read(world.author, world.lab, other)).step).toBe("doi");
  });

  it("is given up when its report was discarded while it was on its way", async () => {
    const world = await setup();
    const key = await sign(world.author, world.own);
    const file = await world.t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.7"])));
    await world.author.mutation(api.reports.flow.discard, { workspaceId: world.own, key });
    expect(await world.author.mutation(api.reports.flow.attachPdf, { workspaceId: world.own, key, file, name: "report.pdf" })).toMatch(/discarded/);
    expect(await world.t.run((ctx) => ctx.db.system.get(file))).toBeNull();
  });

  it("keeps its own details: a save typed over the PDF before it changes nothing", async () => {
    const world = await setup();
    const first = await atDetails(world);
    await world.author.mutation(api.reports.flow.goTo, { workspaceId: world.own, key: first.key, step: "upload" });
    const file = await world.t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.7 a second report"])));
    await world.author.mutation(api.reports.flow.attachPdf, { workspaceId: world.own, key: first.key, file, name: "second.pdf" });
    const second = (await row(world.t, first.key)).pdf!.at;
    await world.t.mutation(internal.reports.readingState.finish, { reportId: first.reportId, at: second, pages: 3, metadata: details("The second PDF's title") });
    // A tab left open on the first PDF's details saves, and asks for the checks.
    await world.author.mutation(api.reports.flow.saveDetails, { workspaceId: world.own, key: first.key, metadata: details("Typed over the first PDF"), pdfAt: first.pdfAt });
    await expect(world.author.mutation(internal.reports.checkRuns.start, { workspaceId: world.own, key: first.key, metadata: details("Typed over the first PDF"), runId: "stale", pdfAt: first.pdfAt })).rejects.toMatchObject(refused("CONFLICT"));
    expect((await read(world.author, world.own, first.key)).metadata?.title).toBe("The second PDF's title");
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
    await world.t.mutation(internal.reports.readingState.finish, { reportId: first.reportId, at: first.pdfAt, pages: 12, metadata: details("The first PDF's title") });
    expect((await read(world.author, world.own, first.key)).step).toBe("upload");
  });

  it("wears the picture drawn of it, and drops one that is too big to be a cover", async () => {
    const world = await setup();
    const key = await sign(world.author, world.own);
    const attach = async (cover: Blob) => {
      const [file, picture] = await world.t.run(async (ctx) => [await ctx.storage.store(new Blob(["%PDF-1.7"])), await ctx.storage.store(cover)] as const);
      await world.author.mutation(api.reports.flow.attachPdf, { workspaceId: world.own, key, file, name: "report.pdf", cover: picture });
      return picture;
    };
    const huge = await attach(new Blob([new Uint8Array(3 * 1024 * 1024)], { type: "image/jpeg" }));
    expect((await read(world.author, world.own, key)).coverUrl).toBeNull();
    expect(await world.t.run((ctx) => ctx.db.system.get(huge))).toBeNull();
    await attach(new Blob(["jpeg"], { type: "image/jpeg" }));
    expect((await read(world.author, world.own, key)).coverUrl).toEqual(expect.any(String));
  });

  it("says when it couldn't be opened, and when its details couldn't be read", async () => {
    const world = await setup();
    const { key, reportId, pdfAt } = await atDetails(world);
    await world.author.mutation(api.reports.flow.goTo, { workspaceId: world.own, key, step: "upload" });
    await world.t.mutation(internal.reports.readingState.finish, { reportId, at: pdfAt });
    expect(await read(world.author, world.own, key)).toMatchObject({ step: "upload", pdf: { trouble: "unopened" } });
    await world.t.mutation(internal.reports.readingState.finish, { reportId, at: pdfAt, pages: 3, metadata: details(), trouble: "unread" });
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

  it("go live when its author activates it, and only once no review is owed", async () => {
    const world = await setup({ humanReview: true });
    const { key } = await checked(world, [passed("byline")]);
    await expect(world.author.mutation(api.reports.flow.activate, { workspaceId: world.own, key })).rejects.toMatchObject(refused("CONFLICT"));
    await world.t.run(async (ctx) => ctx.db.patch("reportSettings", (await ctx.db.query("reportSettings").first())!._id, { humanReview: false }));
    await world.author.mutation(api.reports.flow.activate, { workspaceId: world.own, key });
    // Its route was Crossref alone, so only Crossref's registration is queued.
    expect(await read(world.author, world.own, key)).toMatchObject({ status: "live", deposit: "queued", archive: "none" });
    await expect(world.author.mutation(api.reports.flow.activate, { workspaceId: world.own, key })).rejects.toMatchObject(refused("CONFLICT"));
    await expect(world.author.mutation(api.reports.flow.discard, { workspaceId: world.own, key })).rejects.toMatchObject(refused("CONFLICT"));
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
    const { key, reportId, pdfAt } = await atDetails(world);
    await world.author.mutation(internal.reports.checkRuns.start, { workspaceId: world.own, key, metadata: details(), runId: "old", pdfAt });
    await world.author.mutation(internal.reports.checkRuns.start, { workspaceId: world.own, key, metadata: details("Corrected title"), runId: "new", pdfAt });
    await world.t.mutation(internal.reports.checkRuns.answer, { reportId, runId: "old", result: passed("byline", false) });
    await world.t.mutation(internal.reports.checkRuns.finish, { reportId, runId: "old", results: [passed("byline", false)], version: 1 });
    expect(await read(world.author, world.own, key)).toMatchObject({ step: "details", status: "draft", run: { results: [] }, metadata: { title: "Corrected title" } });
    await world.t.mutation(internal.reports.checkRuns.finish, { reportId, runId: "new", results: [passed("byline")], version: 1 });
    expect(await read(world.author, world.own, key)).toMatchObject({ step: "done", status: "passed" });
    // Checked, it takes no more runs, saves or uploads.
    await expect(world.author.mutation(internal.reports.checkRuns.start, { workspaceId: world.own, key, metadata: details(), runId: "late", pdfAt })).rejects.toMatchObject(refused("CONFLICT"));
    await expect(world.author.mutation(api.reports.flow.startUpload, { workspaceId: world.own, key })).rejects.toMatchObject(refused("CONFLICT"));
    await world.author.mutation(api.reports.flow.saveDetails, { workspaceId: world.own, key, metadata: details("Changed after the checks"), pdfAt });
    expect((await read(world.author, world.own, key)).metadata?.title).toBe("Corrected title");
  });

  it("let a failed report ask for a person, go back for a new PDF, or be discarded", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline", false)]);
    await world.author.mutation(api.reports.flow.requestReview, { workspaceId: world.own, key, comment: "  The byline is on page 2.  " });
    expect(await read(world.author, world.own, key)).toMatchObject({ asked: true, reviewRequest: { comment: "The byline is on page 2." } });
    // Its details open again without a new PDF, and its PDF can be replaced.
    await world.author.mutation(api.reports.flow.goTo, { workspaceId: world.own, key, step: "details" });
    expect(await read(world.author, world.own, key)).toMatchObject({ step: "details", status: "failed", metadata: { title: "Shade trees and maize yields" } });
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

describe("a deleted workspace's reports", () => {
  it("go with it when they never went live, files included, and stay published when they did", async () => {
    const world = await setup();
    const draft = await atDetails(world, world.author, world.lab);
    const draftFile = (await row(world.t, draft.key)).pdf!.file;
    const published = await checked(world, [passed("byline")], world.author, world.lab);
    await world.author.mutation(api.reports.flow.activate, { workspaceId: world.lab, key: published.key });

    expect(await world.t.run((ctx) => purgeWorkspace(ctx, world.lab))).toBe(true);
    expect(await row(world.t, draft.key)).toBeNull();
    expect(await world.t.run((ctx) => ctx.db.system.get(draftFile))).toBeNull();
    expect(await world.t.run((ctx) => ctx.db.query("reportStarts").withIndex("by_workspaceId_and_at", (q) => q.eq("workspaceId", world.lab)).collect())).toEqual([]);
    expect(await row(world.t, published.key)).toMatchObject({ status: "live" });
  });
});

describe("the already-published check's titles", () => {
  it("match across case, accents and punctuation, in any script, and never on nothing", () => {
    expect(sameTitle("Shade Trees & Maize Yields.", "shade trees maize yields")).toBe(true);
    expect(sameTitle("Éducation à l'école", "Education a l ecole")).toBe(true);
    expect(sameTitle("学校教育研究", "学校教育政策研究")).toBe(false);
    expect(sameTitle("学校教育研究", "学校教育研究")).toBe(true);
    expect(sameTitle("…", "!!!")).toBe(false);
  });
});

describe("a report's details", () => {
  it("are refused with an ORCID iD that isn't one, or a title past its limit, and kept otherwise", async () => {
    const world = await setup();
    const { key, pdfAt } = await atDetails(world);
    const author = (orcid: string) => ({ name: "Ada Author", orcid, openalexId: null, affiliations: [], corresponding: true, roles: [] });
    const save = (metadata: Metadata) => world.author.mutation(api.reports.flow.saveDetails, { workspaceId: world.own, key, metadata, pdfAt });
    await expect(save({ ...details(), authors: [author("banana")] })).rejects.toMatchObject(refused("VALIDATION_ERROR"));
    await expect(save({ ...details(), authors: [author("0000-0002-1825-0098")] })).rejects.toMatchObject(refused("VALIDATION_ERROR"));
    await expect(save({ ...details("x".repeat(501)) })).rejects.toMatchObject(refused("VALIDATION_ERROR"));
    await save({ ...details("A kept title"), authors: [author("0000-0002-1825-0097")] });
    expect(await read(world.author, world.own, key)).toMatchObject({ title: "A kept title", metadata: { authors: [{ orcid: "0000-0002-1825-0097" }] } });
  });
});

describe("a workspace's list of reports", () => {
  it("lists the newest first and keeps one stage when asked", async () => {
    const world = await setup();
    const ready = await checked(world, [passed("byline")], world.author, world.lab);
    const failed = await checked(world, [passed("byline", false)], world.author, world.lab);
    const draft = await sign(world.author, world.lab);
    const all = await world.author.query(api.reports.flow.page, { workspaceId: world.lab, page: 1 });
    expect(all.rows.map((r) => r.key)).toEqual([draft, failed.key, ready.key]);
    // A page past the last answers the last, and says which it is.
    expect(await world.author.query(api.reports.flow.page, { workspaceId: world.lab, page: 999, show: "failed" })).toMatchObject({ rows: [{ key: failed.key }], page: 1, pages: 1, total: 1 });
    expect(await world.author.query(api.reports.flow.counts, { workspaceId: world.lab })).toMatchObject({ all: 3, draft: 1, failed: 1, ready: 1, underWay: 3, only: null });
  });
});
