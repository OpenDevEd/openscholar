import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { checked, details, live, passed, row, setReview, setup, type World } from "./reports.test-support";

// The emails are sent by scheduled actions: the tests run them, with no mail service set up, and read what each
// report's record says was written.
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://openscholar.test");
  vi.stubEnv("EL_SMTP_HOST", "");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const emailed = async (world: World, key: string) => {
  await world.t.finishAllScheduledFunctions(vi.runAllTimers);
  const { _id } = await row(world.t, key);
  // Without registrars' accounts in these tests every registration is refused, which ./registration.test.ts covers.
  return world.t.run(async (ctx) => (await ctx.db.query("reportEmails").withIndex("by_reportId", (q) => q.eq("reportId", _id)).take(50)).filter((email) => email.event !== "Registration refused").map((email) => `${email.audience}: ${email.event}`).sort());
};
const decide = async (world: World, key: string, decision: "approve" | "decline" | "withdraw" | "reinstate", note?: string) =>
  world.reviewer.mutation(api.reports.review.decide, { key, decision, seenPdfAt: (await row(world.t, key)).pdf!.at, ...(note && { note }) });

describe("the emails about a report", () => {
  it("tell the team it went live and its author too, and nothing before", async () => {
    const world = await setup();
    const report = await checked(world, [passed("byline"), passed("harm")]);
    expect(await emailed(world, report.key)).toEqual([]);
    await world.author.mutation(api.reports.flow.activate, { workspaceId: world.own, key: report.key });
    expect(await emailed(world, report.key)).toEqual(["author: Live", "team: Went live"]);
  });

  it("tell the team of a report waiting for review and of a request for one, and the author what the reviewer decided", async () => {
    const world = await setup({ humanReview: true });
    const waiting = await checked(world, [passed("byline")]);
    expect(await emailed(world, waiting.key)).toEqual(["team: Waiting for review"]);
    await decide(world, waiting.key, "approve");
    expect(await emailed(world, waiting.key)).toEqual(["author: Approved", "team: Waiting for review"]);

    await setReview(world, false);
    const failed = await checked(world, [passed("byline", false)], world.author, world.lab);
    expect(await emailed(world, failed.key)).toEqual([]);
    await world.author.mutation(api.reports.flow.requestReview, { workspaceId: world.lab, key: failed.key, comment: "It is there" });
    await decide(world, failed.key, "decline", "Not research");
    expect(await emailed(world, failed.key)).toEqual(["author: Declined", "team: Review requested"]);
    // The email carries the reviewer's note and the author's own words, and opens the report where its next step is.
    const text = await world.t.run(async (ctx) => (await ctx.db.query("reportEmails").take(50)).find((email) => email.event === "Declined")!.text);
    expect(text).toContain("Not research");
    expect(text).toContain(`https://openscholar.test/publish?report=${failed.key}`);
  });

  it("tell an author their report was withdrawn and reinstated, and that a reviewer edited its details", async () => {
    const world = await setup();
    const { key } = await live(world);
    await decide(world, key, "withdraw", "Duplicate");
    await decide(world, key, "reinstate");
    await world.reviewer.mutation(api.reports.review.editDetails, { key, seenAt: (await row(world.t, key)).updatedAt, metadata: details("A better title") });
    expect(await emailed(world, key)).toEqual(["author: Details edited", "author: Live", "author: Reinstated", "author: Withdrawn", "team: Went live"]);
  });

  it("tell the team of changes that wait, and the author when they go live or are declined", async () => {
    const world = await setup({ humanReview: true });
    const { key, reportId } = await checked(world, [passed("byline")]);
    await decide(world, key, "approve");
    await world.author.mutation(api.reports.flow.activate, { workspaceId: world.own, key });
    const change = async (title: string) => {
      const report = await row(world.t, key);
      await world.author.mutation(internal.reports.checkRuns.start, { workspaceId: world.own, key, metadata: details(title), runId: `run-${title}`, from: { changesSince: report.correctedAt ?? report.activatedAt! } });
      await world.t.mutation(internal.reports.checkRuns.finish, { reportId, runId: `run-${title}`, results: [passed("byline")], version: 1, metadata: details(title) });
      return (await world.t.run((ctx) => ctx.db.query("reportDetails").withIndex("by_reportId", (q) => q.eq("reportId", reportId)).unique()))!.correction!.at;
    };
    const first = await change("Second title");
    await world.reviewer.mutation(api.reports.review.decideChanges, { key, decision: "decline", seenAt: first, note: "No" });
    const second = await change("Third title");
    await world.reviewer.mutation(api.reports.review.decideChanges, { key, decision: "approve", seenAt: second });
    expect(await emailed(world, key)).toEqual([
      "author: Approved", "author: Changes declined", "author: Changes live", "author: Live",
      "team: Changes waiting for review", "team: Changes waiting for review", "team: Waiting for review", "team: Went live",
    ]);
  });

  it("tell authors whose reports waited only for a reviewer once review is switched off", async () => {
    const world = await setup({ humanReview: true });
    const waiting = await checked(world, [passed("byline")]);
    const flagged = await checked(world, [passed("byline"), passed("research", false, false)], world.author, world.lab);
    await setReview(world, false);
    expect(await emailed(world, waiting.key)).toEqual(["author: Ready to activate", "team: Waiting for review"]);
    expect(await emailed(world, flagged.key)).toEqual(["team: Waiting for review"]);
  });
});
