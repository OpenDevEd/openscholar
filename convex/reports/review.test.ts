import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import { stageOf } from "../../lib/reports/report";
import { SAME_PDF_ADVICE } from "./corrections";
import { checked, details, live, passed, read, refused, row, setReview, setup, type World } from "./reports.test-support";
import { purgeWorkspace } from "../workspaces/purge";

const seen = async (world: World, key: string) => (await row(world.t, key)).pdf!.at;
const decide = async (world: World, key: string, decision: "approve" | "decline" | "withdraw" | "reinstate", note?: string) =>
  world.reviewer.mutation(api.reports.review.decide, { key, decision, seenPdfAt: await seen(world, key), ...(note && { note }) });
const reviewed = async (world: World, key: string) => (await world.reviewer.query(api.reports.review.get, { key }))!;

/** Changes to a live report run through the checks, each answering as given. */
async function change(world: World, key: string, title: string, results: Array<ReturnType<typeof passed> & { fix?: string }> = [passed("byline"), passed("harm")], who = world.author, workspaceId = world.own) {
  const report = await row(world.t, key);
  const started = await who.mutation(internal.reports.checkRuns.start, { workspaceId, key, metadata: details(title), runId: `run-${title}`, from: { changesSince: await openedOn(world, key) } });
  if ("unchanged" in started) return started;
  await world.t.mutation(internal.reports.checkRuns.finish, { reportId: report._id, runId: `run-${title}`, results, version: 1, metadata: details(title) });
  return started;
}

/** What a form of changes opened now would be opened on: the changes that wait, else the live details. */
const openedOn = async (world: World, key: string) => {
  const report = await row(world.t, key);
  const details = await world.t.run((ctx) => ctx.db.query("reportDetails").withIndex("by_reportId", (q) => q.eq("reportId", report._id)).unique());
  return details!.correction?.at ?? report.correctedAt ?? report.activatedAt!;
};

describe("reviewing", () => {
  it("is Openscholar's admins' alone", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline", false)]);
    const no = refused("FORBIDDEN");
    await expect(world.author.query(api.reports.review.page, { page: 1 })).rejects.toMatchObject(no);
    await expect(world.author.query(api.reports.review.get, { key })).rejects.toMatchObject(no);
    await expect(world.author.mutation(api.reports.review.decide, { key, decision: "approve", seenPdfAt: await seen(world, key) })).rejects.toMatchObject(no);
    await expect(world.author.mutation(api.reports.review.editDetails, { key, seenAt: 1, metadata: details("Mine") })).rejects.toMatchObject(no);
    await expect(world.author.mutation(api.reports.review.decideChanges, { key, decision: "approve", seenAt: 1 })).rejects.toMatchObject(no);
    expect(await read(world.author, world.own, key)).toMatchObject({ status: "failed" });
  });

  it("is deleted with a declined report when its workspace is", async () => {
    const world = await setup();
    const { key, reportId } = await checked(world, [passed("byline", false)]);
    await decide(world, key, "decline", "Not research");
    expect(await world.t.run((ctx) => purgeWorkspace(ctx, world.own))).toBe(true);
    expect(await row(world.t, key)).toBeNull();
    expect(await world.t.run((ctx) => ctx.db.query("reportReviews").withIndex("by_reportId", (q) => q.eq("reportId", reportId)).take(5))).toEqual([]);
  });

  it("is never given over another reviewer's without seeing it: a decline asked before an approval is refused, and a decline unapproves", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline", false)]);
    const opened = (await row(world.t, key)).updatedAt;
    await decide(world, key, "approve");
    // The second reviewer's Decline was asked when the report was still failed: it is told what happened instead.
    await expect(world.reviewer.mutation(api.reports.review.decide, { key, decision: "decline", seenPdfAt: await seen(world, key), seenAt: opened })).rejects.toMatchObject(refused("CONFLICT"));
    expect(await row(world.t, key)).toMatchObject({ status: "failed", approved: true });
    // Seeing the approval, they decline anyway: the report is declined, and no longer approved.
    await world.reviewer.mutation(api.reports.review.decide, { key, decision: "decline", seenPdfAt: await seen(world, key), seenAt: (await row(world.t, key)).updatedAt });
    const declined = await row(world.t, key);
    expect(declined.status).toBe("declined");
    expect(declined.approved).toBeUndefined();
  });

  it("approves a report whatever its checks said, so its author can activate it", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline", false)]);
    await decide(world, key, "approve");
    const report = await read(world.author, world.own, key);
    expect(stageOf(report, false)).toBe("ready");
    // The author's page never gets who reviewed it; the reviewer's does, by name.
    expect(report).not.toHaveProperty("reviews");
    expect((await reviewed(world, key)).reviews).toMatchObject([{ decision: "approve", by: "reviewer" }]);
    await expect(decide(world, key, "approve")).rejects.toMatchObject(refused("CONFLICT"));
    await world.author.mutation(api.reports.flow.activate, { workspaceId: world.own, key });
    expect(await read(world.author, world.own, key)).toMatchObject({ status: "live" });
  });

  it("declines with a note the author reads, once", async () => {
    const world = await setup({ humanReview: true });
    const { key } = await checked(world, [passed("byline")]);
    await decide(world, key, "decline", "  A copy of the ministry's report.  ");
    expect(await read(world.author, world.own, key)).toMatchObject({ status: "declined", withdrawn: false, note: "A copy of the ministry's report." });
    await expect(decide(world, key, "decline")).rejects.toMatchObject(refused("CONFLICT"));
    await expect(decide(world, key, "approve")).rejects.toMatchObject(refused("CONFLICT"));
    await expect(world.author.mutation(api.reports.flow.activate, { workspaceId: world.own, key })).rejects.toMatchObject(refused("CONFLICT"));
  });

  it("never takes a late decline for a withdrawal: withdrawing a live report is its own word", async () => {
    const world = await setup();
    const { key } = await live(world);
    // Opened before it went live, the reviewer's Decline changes nothing.
    await expect(decide(world, key, "decline", "Not research.")).rejects.toMatchObject(refused("CONFLICT"));
    expect(await read(world.author, world.own, key)).toMatchObject({ status: "live" });
    await decide(world, key, "withdraw", "Published by mistake.");
    expect(await read(world.author, world.own, key)).toMatchObject({ status: "declined", withdrawn: true, note: "Published by mistake." });
    await decide(world, key, "reinstate");
    const again = await read(world.author, world.own, key);
    expect(again).toMatchObject({ status: "live", withdrawn: false });
    expect(again.note).toBeUndefined();
    expect((await reviewed(world, key)).reviews.map((r) => r.decision)).toEqual(["withdraw", "reinstate"]);
  });

  it("is refused for a PDF uploaded since the reviewer opened the report, and for one its author took back", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline", false)]);
    await expect(world.reviewer.mutation(api.reports.review.decide, { key, decision: "approve", seenPdfAt: 1 })).rejects.toMatchObject(refused("CONFLICT"));
    await world.author.mutation(api.reports.flow.goTo, { workspaceId: world.own, key, step: "upload" });
    await expect(decide(world, key, "approve")).rejects.toMatchObject(refused("CONFLICT"));
  });

  it("lists what wants a reviewer, follows the review switch, and finds a report by its words", async () => {
    const world = await setup({ humanReview: true });
    const waiting = await checked(world, [passed("byline")], world.author, world.lab);
    const failed = await checked(world, [passed("byline", false)], world.author, world.lab);
    await world.author.mutation(api.reports.flow.saveDetails, { workspaceId: world.lab, key: failed.key, metadata: details("Unused"), pdfAt: failed.pdfAt });
    const list = (args: { show?: "all" | "review" | "ready" | "failed"; q?: string } = {}) => world.reviewer.query(api.reports.review.page, { page: 1, ...args });
    expect((await list()).rows.map((r) => r.key)).toEqual([failed.key, waiting.key]);
    expect(await list({ show: "review" })).toMatchObject({ rows: [{ key: waiting.key }], counts: { all: 2, review: 1, failed: 1 }, total: 1 });
    // A failed report whose author asks for a person wants a reviewer too.
    await world.author.mutation(api.reports.flow.requestReview, { workspaceId: world.lab, key: failed.key, comment: "The byline is there." });
    expect((await list({ show: "review" })).counts.review).toBe(2);
    expect((await list({ q: waiting.key.toLowerCase() })).rows.map((r) => r.key)).toEqual([waiting.key]);
    // Review switched off, the report that waited only for it is ready, with nothing done to it.
    await setReview(world, false);
    expect(await list({ show: "ready" })).toMatchObject({ rows: [{ key: waiting.key }] });
    expect((await list({ show: "review" })).rows.map((r) => r.key)).toEqual([failed.key]);
  });
});

describe("changes to a live report", () => {
  it("go live at once when every check passes and review is off, and its registrations are queued again", async () => {
    const world = await setup();
    const { key } = await live(world);
    await world.t.run(async (ctx) => ctx.db.patch("reports", (await ctx.db.query("reports").withIndex("by_key", (q) => q.eq("key", key)).unique())!._id, { deposit: "deposited" }));
    await change(world, key, "A corrected title");
    const report = await read(world.author, world.own, key);
    expect(report).toMatchObject({ status: "live", title: "A corrected title", deposit: "queued", metadata: { title: "A corrected title" } });
    expect(report.correction).toBeUndefined();
    expect(report.correctedAt).toEqual(expect.any(Number));
  });

  it("are refused from a form opened before the report last changed, so one tab never undoes another", async () => {
    const world = await setup();
    const { key } = await live(world);
    const opened = (await row(world.t, key)).activatedAt!;
    await change(world, key, "Changed in the first tab");
    await expect(world.author.mutation(internal.reports.checkRuns.start, { workspaceId: world.own, key, metadata: details("Typed in the stale tab"), runId: "stale", from: { changesSince: opened } })).rejects.toMatchObject(refused("CONFLICT"));
    expect((await read(world.author, world.own, key)).metadata?.title).toBe("Changed in the first tab");
  });

  it("wait for a reviewer while review is on, who approves them or declines them with a note", async () => {
    const world = await setup();
    const { key } = await live(world);
    await setReview(world, true);
    await change(world, key, "Waiting for a person");
    const waiting = await read(world.author, world.own, key);
    expect(waiting).toMatchObject({ changes: "review", title: "Shade trees and maize yields", correction: { metadata: { title: "Waiting for a person" } } });
    const at = waiting.correction!.at;
    // Changes the author has since replaced are never the ones decided.
    await expect(world.reviewer.mutation(api.reports.review.decideChanges, { key, decision: "approve", seenAt: at - 1 })).rejects.toMatchObject(refused("CONFLICT"));
    await world.reviewer.mutation(api.reports.review.decideChanges, { key, decision: "decline", seenAt: at, note: "The title is misleading." });
    expect(await read(world.author, world.own, key)).toMatchObject({ changes: "declined", title: "Shade trees and maize yields", correction: { declined: { note: "The title is misleading." } } });
    // Sent again, they wait again, and approved they are the report's.
    await change(world, key, "A fairer title");
    const again = await read(world.author, world.own, key);
    await world.reviewer.mutation(api.reports.review.decideChanges, { key, decision: "approve", seenAt: again.correction!.at });
    expect(await read(world.author, world.own, key)).toMatchObject({ status: "live", title: "A fairer title" });
    expect((await reviewed(world, key)).reviews.map((r) => r.decision)).toEqual(["decline-changes", "approve-changes"]);
  });

  it("are released when review is switched off, unless a check failed them", async () => {
    const world = await setup();
    const clean = await live(world);
    const flagged = await live(world, world.author, world.lab);
    await setReview(world, true);
    await change(world, clean.key, "Passed and waiting");
    await change(world, flagged.key, "Flagged and waiting", [passed("byline"), passed("published", false, false)], world.author, world.lab);
    await setReview(world, false);
    await world.t.finishAllScheduledFunctions(() => undefined);
    expect(await read(world.author, world.own, clean.key)).toMatchObject({ title: "Passed and waiting" });
    expect(await read(world.author, world.lab, flagged.key)).toMatchObject({ title: "Shade trees and maize yields", changes: "review" });
  });

  it("that a check newly fails are the author's to send again, ask about or discard, and say the PDF is the same", async () => {
    const world = await setup();
    const { key } = await live(world);
    await change(world, key, "Fails the byline now", [{ ...passed("byline", false), fix: "Upload the PDF again." }, passed("harm")]);
    const failed = await read(world.author, world.own, key);
    expect(failed).toMatchObject({ changes: "failed", title: "Shade trees and maize yields" });
    expect(failed.correction!.results[0]!.fix).toBe(SAME_PDF_ADVICE);
    await world.author.mutation(api.reports.flow.requestChangesReview, { workspaceId: world.own, key, seenAt: failed.correction!.at, comment: "The byline hasn't moved." });
    expect(await read(world.author, world.own, key)).toMatchObject({ changes: "review", correction: { request: { comment: "The byline hasn't moved." } } });
    await world.author.mutation(api.reports.flow.discardChanges, { workspaceId: world.own, key, seenAt: failed.correction!.at });
    const kept = await read(world.author, world.own, key);
    expect(kept.correction).toBeUndefined();
    expect(kept.changes).toBeUndefined();
  });

  it("need a reviewer again when the report was approved over a check", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline", false)]);
    await decide(world, key, "approve");
    await world.author.mutation(api.reports.flow.activate, { workspaceId: world.own, key });
    // The same check fails the changes: it was a reviewer's to overrule, and is again.
    await change(world, key, "Changed after an approval", [passed("byline", false)]);
    expect(await read(world.author, world.own, key)).toMatchObject({ changes: "review", title: "Shade trees and maize yields" });
  });

  it("put back to what the report says are no changes, and leave any that wait as they were", async () => {
    const world = await setup();
    const { key } = await live(world);
    await setReview(world, true);
    await change(world, key, "Waiting");
    expect(await change(world, key, "Shade trees and maize yields")).toEqual({ unchanged: true, waiting: true });
    expect(await read(world.author, world.own, key)).toMatchObject({ changes: "review", correction: { metadata: { title: "Waiting" } } });
  });

  it("are kept while their checks run, so a run that never ends loses none, and end when the report is set another way", async () => {
    const world = await setup();
    const { key, reportId } = await live(world);
    await setReview(world, true);
    await change(world, key, "First");
    const first = (await read(world.author, world.own, key)).correction!.at;
    // A second set is being checked when a reviewer approves the first: the run ends there, and its late answer changes nothing.
    const report = await row(world.t, key);
    await world.author.mutation(internal.reports.checkRuns.start, { workspaceId: world.own, key, metadata: details("Second"), runId: "run-second", from: { changesSince: await openedOn(world, key) } });
    expect(await read(world.author, world.own, key)).toMatchObject({ trying: { title: "Second" } });
    await world.reviewer.mutation(api.reports.review.decideChanges, { key, decision: "approve", seenAt: first });
    expect(await world.t.mutation(internal.reports.checkRuns.finish, { reportId, runId: "run-second", results: [passed("byline")], version: 1, metadata: details("Second") })).toBeNull();
    const after = await read(world.author, world.own, key);
    expect(after).toMatchObject({ metadata: { title: "First" } });
    expect(after.run).toBeUndefined();
    expect(after.trying).toBeUndefined();
  });

  it("sent from a form opened before other changes were sent to wait are refused, and those stay as they were", async () => {
    const world = await setup();
    const { key } = await live(world);
    await setReview(world, true);
    // The second tab's form was opened on the live details, before the first tab's changes went to wait.
    const opened = await openedOn(world, key);
    await change(world, key, "From the first tab");
    await expect(world.author.mutation(internal.reports.checkRuns.start, { workspaceId: world.own, key, metadata: details("From the second tab"), runId: "second-tab", from: { changesSince: opened } })).rejects.toMatchObject(refused("CONFLICT"));
    expect(await read(world.author, world.own, key)).toMatchObject({ changes: "review", correction: { metadata: { title: "From the first tab" } } });
    // Opened on the waiting changes, a form may replace them: that is editing them.
    await change(world, key, "Edited while waiting");
    expect(await read(world.author, world.own, key)).toMatchObject({ correction: { metadata: { title: "Edited while waiting" } } });
  });

  it("are checked one set at a time: a second sent while the first runs is refused, not put in its place", async () => {
    const world = await setup();
    const { key } = await live(world);
    const report = await row(world.t, key);
    const start = (title: string) => world.author.mutation(internal.reports.checkRuns.start, { workspaceId: world.own, key, metadata: details(title), runId: `run-${title}`, from: { changesSince: report.activatedAt! } });
    await start("From the first tab");
    await expect(start("From the second tab")).rejects.toMatchObject(refused("CONFLICT"));
    expect((await row(world.t, key)).run).toMatchObject({ id: "run-From the first tab" });
  });

  it("stop being checked when the report is withdrawn, which leaves nothing running on it", async () => {
    const world = await setup();
    const { key } = await live(world);
    const report = await row(world.t, key);
    await world.author.mutation(internal.reports.checkRuns.start, { workspaceId: world.own, key, metadata: details("Mid-run"), runId: "run-mid", from: { changesSince: report.activatedAt! } });
    await decide(world, key, "withdraw");
    expect((await row(world.t, key)).run).toBeUndefined();
  });
});

describe("the reviewers' list", () => {
  it("finds a report by its key", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline", false)]);
    await checked(world, [passed("byline", false)], world.author, world.lab);
    const found = await world.reviewer.query(api.reports.review.page, { page: 1, q: key.toLowerCase() });
    expect(found.rows.map((row) => row.key)).toEqual([key]);
  });
});

describe("a reviewer's own edit", () => {
  it("is the report's at once, recorded, and refused while the author's changes wait or the report changed since", async () => {
    const world = await setup();
    const { key } = await live(world);
    const opened = (await row(world.t, key)).updatedAt;
    const edit = (seenAt: number, title: string) => world.reviewer.mutation(api.reports.review.editDetails, { key, seenAt, metadata: details(title) });
    await expect(edit(opened, "Shade trees and maize yields")).rejects.toMatchObject(refused("VALIDATION_ERROR"));
    expect(await edit(opened, "Fixed by a reviewer")).toBe("Title");
    expect(await read(world.author, world.own, key)).toMatchObject({ status: "live", title: "Fixed by a reviewer", deposit: "queued" });
    // The form it was made from is now behind the report.
    await expect(edit(opened, "From the stale form")).rejects.toMatchObject(refused("CONFLICT"));
    await setReview(world, true);
    await change(world, key, "The author's own change");
    await expect(edit((await row(world.t, key)).updatedAt, "Over the author's change")).rejects.toMatchObject(refused("CONFLICT"));
    expect((await reviewed(world, key)).reviews).toMatchObject([{ decision: "edit", note: "Title" }]);
  });

  it("reaches a report that isn't live without making it so", async () => {
    const world = await setup({ humanReview: true });
    const { key } = await checked(world, [passed("byline")]);
    await world.reviewer.mutation(api.reports.review.editDetails, { key, seenAt: (await row(world.t, key)).updatedAt, metadata: details("Tidied before approval") });
    expect(await read(world.author, world.own, key)).toMatchObject({ status: "passed", title: "Tidied before approval" });
  });
});
