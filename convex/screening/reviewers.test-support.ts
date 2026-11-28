import { excludedFor } from "./facets";
import { NAMED_REASONS } from "../../lib/screening/rules";
import { convexTest } from "convex-test";
import type { FunctionArgs } from "convex/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { seedCreditsForTest } from "../billing/billing.test-support";
import { seedOrganizationFeatures } from "../organizationFeatures.test-support";
import schema from "../schema";
import { ensureWorkspace } from "../workspaces/create";
import { setupScreeningWorkpool } from "./workpool.test-support";

type Open = FunctionArgs<typeof internal.screening.screenings.open>;

/** An organization's workspace with these people in it, each signed in by their name. */
export async function team(names: string[]) {
  const t = convexTest(schema);
  setupScreeningWorkpool(t);
  const { workspaceId, ids } = await t.run(async (ctx) => {
    const ids: Record<string, Id<"users">> = {};
    for (const name of names) ids[name] = await ctx.db.insert("users", { clerkId: name, email: `${name}@test`, state: "active", createdAt: 1, updatedAt: 1 });
    const organizationId = await seedOrganizationFeatures(ctx, names, {});
    const workspaceId = await ensureWorkspace(ctx, { kind: "organization", organizationId });
    await seedCreditsForTest(ctx, { workspaceId, free: 100_000 });
    return { workspaceId, ids };
  });
  const as = Object.fromEntries(names.map((name) => [name, t.withIdentity({ subject: name })]));
  return { t, workspaceId, ids, as };
}
export type Team = Awaited<ReturnType<typeof team>>;

/** An OpenAlex paper with an abstract, by number. */
export const paper = (n: number, more: Partial<Open["sources"][number]> & { doi?: string; abstract?: string; title?: string } = {}) => ({ paper: `openalex:W${n}`, title: `Paper ${n}`, abstract: `What paper ${n} found.`, publicationYear: 2020, ...more });

/**
 * A screening started by the first of `people`, whose first source already holds `papers`: the source is given
 * them in one step, its last, as its reading would. Its own reading then finds nothing left to do.
 */
export async function started({ t, workspaceId, ids }: Team, people: string[], papers: number, setup: Partial<Pick<Open, "rule" | "criteria" | "models" | "saveTo" | "sources">> = {}) {
  const { jobId } = await t.mutation(internal.screening.screenings.open, {
    userId: ids[people[0]!]!,
    workspaceId,
    author: "user",
    name: "Tutoring",
    criteria: [{ text: "Is it about tutoring?", must: true }, { text: "Is it a trial?", must: false }],
    rule: { each: 2, settle: "all", blind: "after" },
    sources: [{ set: { kind: "saved" }, name: "Saved papers" }],
    people: people.map((name) => ids[name]!),
    models: [],
    saveTo: { kind: "none" },
    ...setup,
  });
  // With none, its sources are left unread for the test to give them their records.
  return { jobId, papers: papers ? (await give(t, jobId, 0, Array.from({ length: papers }, (_, n) => paper(n + 1)))).papers : [] };
}

type T = Team["t"];

/** Gives a screening's source `at` these records in one step, and returns the papers it took, in their order. */
export async function give(t: T, jobId: Id<"screeningJobs">, at: number, papers: FunctionArgs<typeof internal.screening.gathering.fill>["papers"]) {
  const { checkId, sourceId, pass, from } = await t.run(async (ctx) => {
    const check = (await ctx.db.query("screeningChecks").withIndex("by_job", (q) => q.eq("jobId", jobId)).order("desc").first())!;
    const source = (await ctx.db.query("screeningSources").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect())[at]!;
    return { checkId: check._id, sourceId: source._id, pass: source.pass ?? 0, from: source.read };
  });
  await t.mutation(internal.screening.gathering.begin, { sourceId, pass });
  await t.mutation(internal.screening.gathering.fill, { checkId, sourceId, pass, from, papers, read: papers.length, ended: true });
  return { checkId, sourceId, papers: await papersOf(t, jobId) };
}

export const papersOf = (t: T, jobId: Id<"screeningJobs">) => t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect());

/** Runs the bookkeeping worker until nothing waits for it: what its query reads, handed to its mutation. */
export async function settleAll(t: T) {
  for (let pass = 0; pass < 200; pass++) {
    const work = await t.query(internal.screening.bookkeeping.nextFinished, { name: "screening" });
    if (work.kind !== "work") return;
    await t.mutation(internal.screening.bookkeeping.bookkeep, work.batch);
  }
  throw new Error("The bookkeeping worker never ran out of papers");
}

/** Runs everything a change sets off, sweeps and worker alike, until nothing is left to run. `runTimers` is the test's `vi.runAllTimers`. */
// Room for the counts a screening keeps beside its papers (../screening/facets.ts), applied a batch at a time: ten people on 5,000 papers is fifty batches.
const SCHEDULED_TURNS = 1_000;

export async function runAll(t: T, runTimers: () => void) {
  for (let pass = 0; pass < 20; pass++) {
    await t.finishAllScheduledFunctions(runTimers, SCHEDULED_TURNS);
    await settleAll(t);
  }
}

/** A screening's rows as a test reads them: each paper's result, and who is on it and how. */
export async function standingOf(t: T, jobId: Id<"screeningJobs">) {
  return t.run(async (ctx) => {
    const reviewers = await ctx.db.query("screeningReviewers").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect();
    const users = new Map(await Promise.all(reviewers.map(async (one) => [one._id, one.userId ? (await ctx.db.get("users", one.userId))!.clerkId : `model:${one.modelId}`] as const)));
    const papers = await ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect();
    const progress = (await ctx.db.query("screeningJobProgress").withIndex("by_job", (q) => q.eq("jobId", jobId)).unique())!;
    const votes = await ctx.db.query("screeningVotes").withIndex("by_job_and_place", (q) => q.eq("jobId", jobId)).collect();
    return {
      papers: papers.map((one) => ({ title: one.title, result: one.result, reason: one.reason, on: Object.fromEntries(votes.filter((vote) => vote.resultId === one._id).map((vote) => [users.get(vote.reviewerId)!, vote.decision ?? vote.status])) })),
      counts: progress.counts,
      reasons: await excludedFor(ctx as never, jobId, [...((await ctx.db.get("screeningJobs", jobId))!.criteria ?? []).map((one) => one.key), ...NAMED_REASONS]),
      reviewers: Object.fromEntries(reviewers.map((one) => [users.get(one._id)!, { dealt: one.dealt, ...progress.reviewers?.[one._id] }])),
      agreement: await ctx.db.query("screeningAgreement").withIndex("by_job_and_a_and_b", (q) => q.eq("jobId", jobId)).collect(),
    };
  });
}
