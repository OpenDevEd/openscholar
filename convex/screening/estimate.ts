import type { Infer } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { libraryCountRow } from "../library/counter";
import { collectionAllowed } from "../library/collections";
import { requestOf, snapshotOf } from "../paperSets/search";
import { findSearch } from "../research/records";
import { isInWorkspace, type InWorkspace } from "../workspaces/actor";
import { currentSearch } from "../../lib/research/records";
import { MAX_QUESTIONS } from "../lib/listCaps";
import { taskPricing } from "../ai/serverModel";
import { checkRequestPapers } from "../billing/accounts";
import { screeningPaperCredits } from "../../lib/pricing";
import { createError } from "../lib/errors";
import type { paperSetValidator, saveToValidator, screeningScoringConfigValidator } from "./validators";

/**
 * Refuses a screening whose rules include every paper, whatever it's answered: one with no
 * `minimumScore` (./scoring.ts reads none as every paper qualifying). The screening page always
 * sets one; a call that leaves it out is told so before the person is asked to pay for it.
 */
export function requireMinimum(config: Infer<typeof screeningScoringConfigValidator>) {
  if (config.minimumScore === undefined) {
    throw createError("VALIDATION_ERROR", "scoringConfig needs minimumScore, the least score a paper needs to be included: without it every paper is included whatever it's answered. With one question worth 1 point for yes, that's 1.");
  }
}

/**
 * What screening `papers` papers holds against an `available` balance at `perPaper` credits a
 * paper (lib/pricing/estimate.ts `screeningPaperCredits`), and how many papers that balance
 * covers: the hold a job takes when it starts. The Screen all dialog and the assistant's
 * approval card both show it.
 */
export function estimateScreening(papers: number, available: number, perPaper: number) {
  return {
    credits: Math.max(0, papers) * perPaper,
    available,
    affordablePapers: Math.floor(available / perPaper),
  };
}

/** What screening one paper costs a person at most, on the model their Screen all runs on. */
export async function screeningPaperCreditsFor(ctx: QueryCtx, userId: Id<"users">) {
  return screeningPaperCredits(await taskPricing(ctx, userId, "screenAll"));
}

/**
 * How many papers a set holds, where the account keeps count: a collection, the library, a
 * screening's included papers. Null when it doesn't, or the set isn't the person's. A
 * search's papers are OpenAlex's to count: the figure its page last saw can be behind, and
 * is 0 on a search not counted yet, so it says nothing about what a job would read.
 */
export async function papersIn(ctx: QueryCtx, { userId, workspaceId }: InWorkspace, set: Infer<typeof paperSetValidator>): Promise<number | null> {
  if (set.kind === "collection") {
    const collection = await ctx.db.get("collections", set.collectionId);
    return collection?.workspaceId === workspaceId ? collection.itemCount : null;
  }
  if (set.kind === "saved") return (await libraryCountRow(ctx, workspaceId))?.count ?? null;
  if (set.kind === "screening") {
    const job = await ctx.db.get("screeningJobs", set.jobId);
    if (!job || !(await isInWorkspace(ctx, job, workspaceId))) return null;
    return (await ctx.db.query("screeningJobProgress").withIndex("by_job", (q) => q.eq("jobId", set.jobId)).unique())?.qualified ?? null;
  }
  return null;
}

/**
 * What starting a screening refuses that can be read before the person is asked to pay for it
 * (./start.ts, ./mutations.ts `insertJob`), so that a yes is never followed by a refusal: its
 * rules, its range, its set, and where its papers go. Only what OpenAlex says of a search, and a
 * balance that changed since, are left.
 */
export async function checkScreening(ctx: QueryCtx, { userId, workspaceId }: InWorkspace, { set, first, last, questions, scoringConfig, saveTo, prune }: { set: Infer<typeof paperSetValidator>; first: number; last: number; questions: Array<{ question: string }>; scoringConfig: Infer<typeof screeningScoringConfigValidator>; saveTo?: Infer<typeof saveToValidator>; prune?: boolean }) {
  requireMinimum(scoringConfig);
  if (questions.length > MAX_QUESTIONS) throw createError("VALIDATION_ERROR", `A screening asks up to ${MAX_QUESTIONS} questions.`);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first) throw createError("VALIDATION_ERROR", "Pick papers from 1 up, with the first before the last");
  if (prune && set.kind !== "collection") throw createError("VALIDATION_ERROR", "Only a collection's papers can leave it");
  if (set.kind === "search") {
    const row = await findSearch(ctx, workspaceId, set.searchId);
    if (!row) throw createError("NOT_FOUND", "Search not found");
    // A query the results page can't make is refused as the start would refuse it; only what OpenAlex makes of one it can is left to the start.
    snapshotOf(await requestOf(ctx, { userId, workspaceId }, currentSearch(row.data), row.revision));
    // The search's page takes on the questions it doesn't ask yet (./mutations.ts `insertJob`), and holds MAX_QUESTIONS.
    const asked = new Set([...row.data.screeningQuestions.map(({ question }) => question), ...questions.map(({ question }) => question)]);
    if (asked.size > MAX_QUESTIONS) throw createError("VALIDATION_ERROR", `This search's page already asks ${row.data.screeningQuestions.length} screening questions, and holds up to ${MAX_QUESTIONS}: ask fewer new ones, or ask the ones it has.`);
    await checkRequestPapers(ctx, userId, last - first + 1, "screening");
  } else {
    const source = set.kind === "collection" ? await ctx.db.get("collections", set.collectionId) : set.kind === "screening" ? await ctx.db.get("screeningJobs", set.jobId) : null;
    const mine = set.kind !== "collection" && set.kind !== "screening" ? true : source !== null && (await isInWorkspace(ctx, source, workspaceId));
    if (!mine) throw createError("NOT_FOUND", set.kind === "collection" ? "Collection not found" : "Screening not found");
    const held = await papersIn(ctx, { userId, workspaceId }, set);
    if (held !== null && first > held) throw createError("VALIDATION_ERROR", "There are no papers in that range");
    await checkRequestPapers(ctx, userId, Math.min(last, held ?? last) - first + 1, "screening");
  }
  if (saveTo?.kind === "new") await collectionAllowed(ctx, { userId, workspaceId }, saveTo.name);
  if (saveTo?.kind === "collection" && (await ctx.db.get("collections", saveTo.collectionId))?.workspaceId !== workspaceId) throw createError("NOT_FOUND", "Collection not found");
}

/**
 * The most screening papers `first` to `last` of a set holds: the estimate for every paper in
 * that range, up to how many the set is known to have. For a search that is the whole range
 * asked for. Papers a search's page already answered cost nothing, so it is an upper figure.
 */
export async function screeningHold(ctx: QueryCtx, reader: InWorkspace, request: Parameters<typeof checkScreening>[2]) {
  const { userId } = reader;
  await checkScreening(ctx, reader, request);
  const { set, first, last } = request;
  const held = await papersIn(ctx, reader, set);
  return estimateScreening(Math.max(0, Math.min(last, held ?? last) - first + 1), 0, await screeningPaperCreditsFor(ctx, userId)).credits;
}
