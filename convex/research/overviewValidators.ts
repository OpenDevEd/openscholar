/**
 * AI overviews of a search (#967): what the Cheap preset's model writes about a whole search, read through a lens
 * the person picks. Apart from the functions, so the schema can load them.
 */
import { v } from "convex/values";
import { capped } from "../lib/listCaps";
import { GROUPINGS, type Grouping } from "./searchValidators";

/** Lenses a person keeps for themselves in a workspace, and lenses a workspace shares. */
export const OWN_LENSES = 12;
export const SHARED_LENSES = 24;
/** Shared and built-in lenses a person can take off their own list: the three built-in ones after Overview, and every shared one. */
export const HIDDEN_LENSES = 27;
export const NAME_MAX = 40;
export const INSTRUCTION_MAX = 600;

/** Counts and paper lists one overview keeps, groups in a count, and papers in a list. */
export const COUNTS_KEPT = 6;
export const LISTS_KEPT = 6;
export const GROUPS_KEPT = 30;
export const PAPERS_KEPT = 10;
/** Characters of an overview's text kept. */
export const TEXT_MAX = 6_000;

/**
 * The lenses everyone has, which nobody edits: the instruction is what the model reads, the
 * name is a key the page translates.
 */
export const BUILT_IN_LENSES = [
  { id: "overview", instruction: "What this research covers, how much of it there is, and where to start reading." },
  { id: "trend", instruction: "How output changes from year to year: growth, dips, and the years that stand out." },
  { id: "where", instruction: "Which countries the authors work in, and how concentrated the field is." },
  { id: "read", instruction: "The most cited papers and the newest ones worth knowing." },
] as const;
export type BuiltInLens = (typeof BUILT_IN_LENSES)[number]["id"];
/** The lens nobody can take off their list, opened until they pick another. */
export const DEFAULT_LENS: BuiltInLens = "overview";

/** A lens a person wrote. `version` grows with each edit, so an overview written before it isn't shown for it. */
export const lensValidator = v.object({ id: v.string(), name: v.string(), instruction: v.string(), version: v.number() });
export const sharedLensValidator = v.object({ ...lensValidator.fields, ownerId: v.id("users") });

export const overviewPrefsFields = {
  workspaceId: v.id("workspaces"),
  userId: v.id("users"),
  /** The lens open on results pages. */
  open: v.string(),
  /** Folded, nothing is written: it's how a person pauses overviews. */
  collapsed: v.boolean(),
  lenses: capped(v.array(lensValidator), OWN_LENSES),
  /** Shared and built-in lenses taken off this person's list. */
  hidden: capped(v.array(v.string()), HIDDEN_LENSES),
  /** The day, in UTC (2026-10-29), the counts below are for: a new day starts them again. */
  day: v.optional(v.string()),
  /** Overviews written free today, against the plan's `overviews_per_day`, and paid with credits, against PAID_PER_DAY. */
  free: v.optional(v.number()),
  paid: v.optional(v.number()),
};

export const overviewSharedFields = {
  workspaceId: v.id("workspaces"),
  lenses: capped(v.array(sharedLensValidator), SHARED_LENSES),
};

const groupingValidator = v.union(...(Object.keys(GROUPINGS) as Grouping[]).map((name) => v.literal(name)));
const yearsValidator = v.object({ from: v.optional(v.number()), to: v.optional(v.number()) });

/** A count the model read, which a chart draws: the ID is what its text's marker names. */
export const overviewCountValidator = v.object({
  id: v.string(),
  by: groupingValidator,
  total: v.number(),
  groups: capped(v.array(v.object({ key: v.string(), name: v.string(), count: v.number() })), GROUPS_KEPT),
  years: v.optional(yearsValidator),
});
export const overviewPaperValidator = v.object({ id: v.string(), title: v.string(), year: v.optional(v.number()), cited: v.number() });
/** Papers the model read, which its text cites by ID. */
export const overviewListValidator = v.object({ id: v.string(), papers: capped(v.array(overviewPaperValidator), PAPERS_KEPT) });

/** Why a run failed: the credits it needed weren't there, it failed, or it took too long. */
export const overviewErrorValidator = v.union(v.literal("credits"), v.literal("failed"), v.literal("timeout"));
export const overviewStatusValidator = v.union(v.literal("running"), v.literal("done"), v.literal("failed"));

export const searchOverviewFields = {
  workspaceId: v.id("workspaces"),
  /** The search's OpenAlex request it was written for, hashed: a search whose request is the same reads the same overview. */
  request: v.string(),
  /** The lens: a built-in one's ID, or a written one's ID and version. */
  lens: v.string(),
  /** Who asked for it, whose day it counted against. */
  askedBy: v.id("users"),
  /** Paid with credits rather than free. */
  paid: v.boolean(),
  /** The day, in UTC, it was counted against: a failed run gives it back only on that day's count. */
  day: v.string(),
  status: overviewStatusValidator,
  /** When the run writing it started: a run that dies never says it ended, so it's ended this long after. */
  startedAt: v.number(),
  /**
   * What the model is doing, while it runs, as a code the page words: `count:<grouping>:<from>:<to>` (years empty
   * when it counts them all), `papers:<cited|newest|relevance>`, or `writing`.
   */
  step: v.optional(v.string()),
  /** What it has written: whole lines only while it runs. */
  text: v.string(),
  counts: capped(v.array(overviewCountValidator), COUNTS_KEPT),
  lists: capped(v.array(overviewListValidator), LISTS_KEPT),
  error: v.optional(overviewErrorValidator),
};

/** Lenses on one person's list: the built-in ones, their own and the workspace's shared ones. */
export const LENSES_LISTED = 40;
export const overviewLensValidator = v.object({
  id: v.string(),
  /** A built-in lens, whose name the page translates; a written one has its own name. */
  builtIn: v.optional(v.union(...BUILT_IN_LENSES.map((lens) => v.literal(lens.id)))),
  name: v.optional(v.string()),
  instruction: v.string(),
  version: v.number(),
  shared: v.boolean(),
  /** The person wrote it, so they change it. */
  mine: v.boolean(),
});
export const overviewViewValidator = v.object({
  lenses: capped(v.array(overviewLensValidator), LENSES_LISTED),
  open: v.string(),
  collapsed: v.boolean(),
  day: v.optional(v.string()),
  free: v.number(),
  paid: v.number(),
  perDay: v.union(v.number(), v.null()),
  paidPerDay: v.number(),
  credits: v.union(v.number(), v.null()),
});
export const overviewShownValidator = v.object({
  available: v.boolean(),
  /** Why it has none: the workspace doesn't have the search, it's written in OQL, or it's filtered by the person's ratings. */
  reason: v.optional(v.union(v.literal("missing"), v.literal("oql"), v.literal("ratings"))),
  overview: v.union(
    v.null(),
    v.object({
      status: overviewStatusValidator,
      step: v.optional(v.string()),
      text: v.string(),
      counts: capped(v.array(overviewCountValidator), COUNTS_KEPT),
      lists: capped(v.array(overviewListValidator), LISTS_KEPT),
      paid: v.boolean(),
      error: v.optional(overviewErrorValidator),
    }),
  ),
});
