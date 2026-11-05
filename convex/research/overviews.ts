/**
 * AI overviews of a search (#967). The results page shows one for the lens the person has open; ./overviewsAction.ts
 * writes it on the person's model for overviews, from counts and papers of the search it reads itself. An overview is
 * stored by the search's OpenAlex request and the lens, so a search that asks the same reads it again for nothing.
 *
 * Go and above write the open lens free, up to the plan's `overviews_per_day` a day, for people on a preset. Past it,
 * on a plan without it, and on Custom, an overview waits for the person to ask and is paid in credits, up to PAID_PER_DAY a day. Folded, the page asks
 * for nothing: that's how a person pauses them.
 */
import { v, type Infer } from "convex/values";
import { internalMutation, type MutationCtx, type QueryCtx } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { accountMutation, accountQuery, assistantMutation, assistantQuery, defineUserMutation, defineUserQuery, type Acting } from "../lib/userActions";
import { createError } from "../lib/errors";
import { planLimit } from "../billing/accounts";
import { organizationPreset, resolveTaskPick, userAiConfig } from "../ai/serverModel";
import { effortValidator } from "../aiModelConfig/validators";
import { requestOf } from "../paperSets/search";
import { searchRequestValidator } from "../paperSets/openalex";
import { currentSearch } from "../../lib/research/records";
import { CALL_TOKENS, estimateCredits } from "../../lib/pricing/estimate";
import { findSearch } from "./records";
import { defaultLocale, locales } from "../../i18n/config";
import {
  BUILT_IN_LENSES,
  COUNTS_KEPT,
  DEFAULT_LENS,
  GROUPS_KEPT,
  INSTRUCTION_MAX,
  LISTS_KEPT,
  NAME_MAX,
  OWN_LENSES,
  PAPERS_KEPT,
  SHARED_LENSES,
  TEXT_MAX,
  overviewCountValidator,
  overviewErrorValidator,
  overviewListValidator,
  overviewViewValidator,
  overviewShownValidator,
  type BuiltInLens,
} from "./overviewValidators";

/** Overviews a person can have paid in credits in a day, on any plan. */
export const PAID_PER_DAY = 20;
/** How long a run may take before it's counted as failed: a run that died never says it ended. */
const RUN_MS = 3 * 60_000;

const BUILT_IN = new Map<string, (typeof BUILT_IN_LENSES)[number]>(BUILT_IN_LENSES.map((lens) => [lens.id, lens]));

const prefsOf = (ctx: QueryCtx | MutationCtx, workspaceId: Id<"workspaces">, userId: Id<"users">) =>
  ctx.db.query("overviewPrefs").withIndex("by_workspace_and_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId)).unique();
const sharedOf = (ctx: QueryCtx | MutationCtx, workspaceId: Id<"workspaces">) =>
  ctx.db.query("overviewShared").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).unique();

/** The person's row, made with what a new one holds. */
async function ownPrefs(ctx: MutationCtx, { workspaceId, userId }: Acting): Promise<Doc<"overviewPrefs">> {
  const row = await prefsOf(ctx, workspaceId, userId);
  if (row) return row;
  const id = await ctx.db.insert("overviewPrefs", { workspaceId, userId, open: DEFAULT_LENS, collapsed: false, lenses: [], hidden: [] });
  return (await ctx.db.get("overviewPrefs", id))!;
}

/** The lenses on a person's list: the built-in ones, theirs, and the workspace's shared ones, less those they took off. */
function lensesOn(prefs: Doc<"overviewPrefs"> | null, shared: Doc<"overviewShared"> | null, userId: Id<"users">) {
  const hidden = new Set(prefs?.hidden ?? []);
  return [
    ...BUILT_IN_LENSES.filter((lens) => lens.id === DEFAULT_LENS || !hidden.has(lens.id)).map((lens) => ({ id: lens.id, builtIn: lens.id as BuiltInLens, instruction: lens.instruction, version: 0, shared: false, mine: false })),
    ...(prefs?.lenses ?? []).map((lens) => ({ ...lens, shared: false, mine: true })),
    ...(shared?.lenses ?? []).filter((lens) => lens.ownerId === userId || !hidden.has(lens.id)).map(({ ownerId, ...lens }) => ({ ...lens, shared: true, mine: ownerId === userId })),
  ];
}

/** The lens by its ID, on the person's list, and the key its overviews are stored by. */
async function lensFor(ctx: QueryCtx, actor: Pick<Acting, "workspaceId" | "userId">, id: string) {
  const lens = lensesOn(await prefsOf(ctx, actor.workspaceId, actor.userId), await sharedOf(ctx, actor.workspaceId), actor.userId).find((one) => one.id === id);
  if (!lens) throw createError("NOT_FOUND", "That lens isn't on your list.");
  return { ...lens, key: lens.version ? `${lens.id}@${lens.version}` : lens.id };
}

/** A short, stable digest of a search's request, as its overviews are stored by: two 53-bit hashes (cyrb53). */
function digest(text: string) {
  const half = (seed: number) => {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  };
  return `${half(1)}${half(2)}`;
}

/**
 * The search the person reads on its results page, and its OpenAlex request, or why it has no overview: the workspace
 * doesn't have it (a search shared with the person as a guest), it's written in OQL, which OpenAlex doesn't group, or
 * its results are filtered by the person's ratings, which OpenAlex can't count.
 */
async function searchFor(ctx: QueryCtx, actor: Pick<Acting, "workspaceId" | "userId">, searchId: string) {
  const row = await findSearch(ctx, actor.workspaceId, searchId);
  if (!row) return { reason: "missing" as const };
  const { request, ratingRange } = await requestOf(ctx, actor, currentSearch(row.data), row.revision);
  // Our index can't group a search by meaning, and an overview is built on those counts.
  if (!request || request.oql || (request.source === "openscholar" && (request.semantic || request.similarTo))) return { reason: "oql" as const };
  if (ratingRange) return { reason: "ratings" as const };
  // An overview written from one source isn't the same search's on another. OpenAlex's keep the keys they were stored by.
  return { request, key: digest(JSON.stringify([request.search ?? request.semantic ?? "", request.filter ?? "", ...(request.source === "openscholar" ? [request.source] : [])])) };
}

/** The languages the app speaks, which an overview is written in: the page's. */
const localeValidator = v.union(...locales.map((locale) => v.literal(locale)));
/** The key an overview is stored by: its lens, and the language it's written in. One in American English keeps the bare lens key. */
const inLanguage = (lens: string, locale: string | undefined) => (!locale || locale === defaultLocale ? lens : `${lens}~${locale}`);

const storedOf = (ctx: QueryCtx, workspaceId: Id<"workspaces">, request: string, lens: string) =>
  ctx.db.query("searchOverviews").withIndex("by_workspace_and_request_and_lens", (q) => q.eq("workspaceId", workspaceId).eq("request", request).eq("lens", lens)).unique();

/** Today in UTC, as a person's day counts are kept: it starts at midnight UTC, as Autumn resets a daily limit. */
const today = () => new Date().toISOString().slice(0, 10);

/** What one overview paid in credits costs, at the price of the model it would run on for this person; null without one. */
async function paidCredits(ctx: QueryCtx, actor: { userId: Id<"users">; workspaceId: Id<"workspaces"> }) {
  const pick = await resolveTaskPick(ctx, actor, "overview");
  const model = pick ? await ctx.db.get("models", pick.modelId) : null;
  return model ? estimateCredits({ input: model.inputPricePerMillion, output: model.outputPricePerMillion }, CALL_TOKENS.overview) : null;
}

/**
 * Free overviews a person gets a day: the plan's, or none on Custom. An organization's work always runs on its preset,
 * so only a person's own workspace can be on Custom. Undefined when the plan has no limit.
 */
async function freePerDay(ctx: QueryCtx, { userId, workspaceId }: { userId: Id<"users">; workspaceId: Id<"workspaces"> }) {
  const onCustom = (await organizationPreset(ctx, workspaceId)) === null && (await userAiConfig(ctx, userId))?.choice === "custom";
  return onCustom ? 0 : await planLimit(ctx, workspaceId, "overviews_per_day");
}

export const viewAction = defineUserQuery({
  path: "research/overviews:view",
  description:
    "The person's lenses for AI overviews of a search in this workspace: the built-in ones, their own and the workspace's shared ones, each with what it asks. Also the lens open on results pages, whether overviews are folded (paused), and today's count of free and paid overviews (`day` is the UTC date they're for), with the plan's free ones a day (null: no limit), Pro's, and what a paid one costs in credits.",
  args: {},
  returns: overviewViewValidator,
  run: async (ctx, { userId, workspaceId }) => {
    const prefs = await prefsOf(ctx, workspaceId, userId);
    const lenses = lensesOn(prefs, await sharedOf(ctx, workspaceId), userId);
    const perDay = await freePerDay(ctx, { userId, workspaceId });
    return {
      lenses,
      open: lenses.some((lens) => lens.id === prefs?.open) ? prefs!.open : DEFAULT_LENS,
      collapsed: prefs?.collapsed ?? false,
      ...(prefs?.day ? { day: prefs.day } : {}),
      free: prefs?.free ?? 0,
      paid: prefs?.paid ?? 0,
      perDay: perDay ?? null,
      paidPerDay: PAID_PER_DAY,
      credits: await paidCredits(ctx, { userId, workspaceId }),
    };
  },
});
export const view = accountQuery(viewAction);
export const viewForAssistant = assistantQuery(viewAction);

export const getAction = defineUserQuery({
  path: "research/overviews:get",
  description:
    "The AI overview of a search through a lens, in a language (`locale`, American English when left out), by the search's ID as its results page shows it and the lens's ID: its text, with charts as [chart:ID] lines drawing `counts` and papers cited as [words](paper:ID) from `lists`. `status` is running while it's written, then done or failed. Null when none has been written; `available` is false, with its `reason`, for a search this workspace doesn't have, one written in OQL, or one filtered by the person's ratings. research/overviews:ensure writes one.",
  args: { searchId: v.string(), lens: v.string(), locale: v.optional(localeValidator) },
  returns: overviewShownValidator,
  run: async (ctx, actor, { searchId, lens, locale }) => {
    const search = await searchFor(ctx, actor, searchId);
    if ("reason" in search) return { available: false, reason: search.reason, overview: null };
    // A lens taken off the list in another tab is read until the page hears of it: nothing is written for it.
    const found = await lensFor(ctx, actor, lens).catch(() => null);
    const stored = found ? await storedOf(ctx, actor.workspaceId, search.key, inLanguage(found.key, locale)) : null;
    return {
      available: true,
      overview: stored ? { status: stored.status, ...(stored.step ? { step: stored.step } : {}), text: stored.text, counts: stored.counts, lists: stored.lists, paid: stored.paid, ...(stored.error ? { error: stored.error } : {}) } : null,
    };
  },
});
export const get = accountQuery(getAction);
export const getForAssistant = assistantQuery(getAction);

const ensured = v.union(v.literal("written"), v.literal("writing"), v.literal("started"), v.literal("ask"), v.literal("limit"), v.literal("unavailable"));

export const ensureAction = defineUserMutation({
  path: "research/overviews:ensure",
  description:
    "Has the AI overview of a search through a lens written, in the page's language (`locale`, American English when left out), if it isn't yet: `written` or `writing` when it is, `started` when this starts it. Free while the plan's overviews a day last; past them, or on a plan without them, it's `ask` unless `pay` is true, which pays for it in credits, up to 20 a day (`limit` past that). `again` writes it anew, as Write again does. `unavailable` for a search written in OQL or filtered by the person's ratings. Read it with research/overviews:get.",
  args: { searchId: v.string(), lens: v.string(), locale: v.optional(localeValidator), pay: v.optional(v.boolean()), again: v.optional(v.boolean()) },
  returns: ensured,
  spendsCredits: true,
  outsideEffect: false,
  undoable: false,
  estimate: async (ctx, actor, { pay }) => (pay ? ((await paidCredits(ctx, actor)) ?? 0) : 0),
  run: async (ctx, actor, { searchId, lens: lensId, locale, pay, again }): Promise<Infer<typeof ensured>> => {
    const search = await searchFor(ctx, actor, searchId);
    if ("reason" in search) return "unavailable";
    const lens = await lensFor(ctx, actor, lensId);
    const key = inLanguage(lens.key, locale);
    const stored = await storedOf(ctx, actor.workspaceId, search.key, key);
    if (stored?.status === "running") return "writing";
    if (stored?.status === "done" && !again) return "written";
    const prefs = await ownPrefs(ctx, actor);
    const day = today();
    const counts = prefs.day === day ? { free: prefs.free ?? 0, paid: prefs.paid ?? 0 } : { free: 0, paid: 0 };
    const perDay = await freePerDay(ctx, actor);
    const free = perDay === undefined || counts.free < perDay;
    if (!free && !pay) return "ask";
    if (!free && counts.paid >= PAID_PER_DAY) return "limit";
    const pick = await resolveTaskPick(ctx, actor, "overview");
    if (!pick) throw createError("VALIDATION_ERROR", "No model writes overviews right now. Try again later.");
    await ctx.db.patch("overviewPrefs", prefs._id, { day, ...(free ? { free: counts.free + 1, paid: counts.paid } : { free: counts.free, paid: counts.paid + 1 }) });
    const startedAt = Date.now();
    const fields = { askedBy: actor.userId, paid: !free, day, status: "running" as const, startedAt, text: "", counts: [], lists: [] };
    let overviewId = stored?._id;
    if (overviewId) await ctx.db.patch("searchOverviews", overviewId, { ...fields, step: undefined, error: undefined });
    else overviewId = await ctx.db.insert("searchOverviews", { workspaceId: actor.workspaceId, request: search.key, lens: key, ...fields });
    await ctx.scheduler.runAfter(0, internal.research.overviewsAction.run, { overviewId, startedAt, request: search.request, instruction: lens.instruction, locale: locale ?? defaultLocale, modelId: pick.modelId, ...(pick.effort ? { effort: pick.effort } : {}) });
    await ctx.scheduler.runAfter(RUN_MS, internal.research.overviews.expire, { overviewId, startedAt });
    return "started";
  },
});
export const ensure = accountMutation(ensureAction);
export const ensureForAssistant = assistantMutation(ensureAction);

/** A lens's name and words, as a person writes them. */
function cleanLens(name: string, instruction: string) {
  const kept = { name: name.trim().slice(0, NAME_MAX), instruction: instruction.trim().slice(0, INSTRUCTION_MAX) };
  if (!kept.name || !kept.instruction) throw createError("VALIDATION_ERROR", "A lens needs a name and what to look at.");
  return kept;
}

export const saveLensAction = defineUserMutation({
  path: "research/overviews:saveLens",
  description:
    "Writes a lens for AI overviews, or changes one the person wrote (`id`): a name, and what an overview read through it should look at. `shared` puts it on the list of everyone in the workspace; only who wrote it changes it. A new lens opens on results pages. Returns its ID.",
  args: { id: v.optional(v.string()), name: v.string(), instruction: v.string(), shared: v.boolean() },
  returns: v.string(),
  spendsCredits: false,
  outsideEffect: false,
  undoable: false,
  run: async (ctx, actor, { id, name, instruction, shared }) => {
    const words = cleanLens(name, instruction);
    const prefs = await ownPrefs(ctx, actor);
    const sharedRow = await sharedOf(ctx, actor.workspaceId);
    const before = id ? (prefs.lenses.find((lens) => lens.id === id) ?? sharedRow?.lenses.find((lens) => lens.id === id && lens.ownerId === actor.userId)) : undefined;
    if (id && !before) throw createError("NOT_FOUND", "Only who wrote a lens changes it.");
    const lens = { id: before?.id ?? `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, ...words, version: (before?.version ?? 0) + 1 };
    const own = prefs.lenses.filter((one) => one.id !== lens.id);
    const others = (sharedRow?.lenses ?? []).filter((one) => one.id !== lens.id);
    if (!shared && own.length >= OWN_LENSES) throw createError("CONFLICT", `You can keep ${OWN_LENSES} lenses of your own. Delete one first.`);
    if (shared && others.length >= SHARED_LENSES) throw createError("CONFLICT", `A workspace shares at most ${SHARED_LENSES} lenses. Ask someone to stop sharing one first.`);
    await ctx.db.patch("overviewPrefs", prefs._id, { lenses: shared ? own : [...own, lens], ...(before ? {} : { open: lens.id }) });
    const sharedLenses = shared ? [...others, { ...lens, ownerId: actor.userId }] : others;
    if (sharedRow) await ctx.db.patch("overviewShared", sharedRow._id, { lenses: sharedLenses });
    else if (shared) await ctx.db.insert("overviewShared", { workspaceId: actor.workspaceId, lenses: sharedLenses });
    return lens.id;
  },
});
export const saveLens = accountMutation(saveLensAction);
export const saveLensForAssistant = assistantMutation(saveLensAction);

export const removeLensAction = defineUserMutation({
  path: "research/overviews:removeLens",
  description:
    "Takes a lens off the person's list: deletes one they wrote, shared or not, and hides a built-in one or one someone else shared from them alone. The Overview lens stays.",
  args: { id: v.string() },
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: false,
  undoable: false,
  run: async (ctx, actor, { id }) => {
    if (id === DEFAULT_LENS) throw createError("VALIDATION_ERROR", "The Overview lens stays on every list.");
    const prefs = await ownPrefs(ctx, actor);
    const sharedRow = await sharedOf(ctx, actor.workspaceId);
    const open = prefs.open === id ? { open: DEFAULT_LENS } : {};
    if (prefs.lenses.some((lens) => lens.id === id)) {
      await ctx.db.patch("overviewPrefs", prefs._id, { lenses: prefs.lenses.filter((lens) => lens.id !== id), ...open });
    } else if (sharedRow?.lenses.some((lens) => lens.id === id && lens.ownerId === actor.userId)) {
      await ctx.db.patch("overviewShared", sharedRow._id, { lenses: sharedRow.lenses.filter((lens) => lens.id !== id) });
      await ctx.db.patch("overviewPrefs", prefs._id, open);
    } else if (BUILT_IN.has(id) || sharedRow?.lenses.some((lens) => lens.id === id)) {
      // Only lenses that still exist stay hidden, so shared lenses that come and go never fill the list.
      const exists = new Set([...BUILT_IN.keys(), ...(sharedRow?.lenses ?? []).map((lens) => lens.id)]);
      await ctx.db.patch("overviewPrefs", prefs._id, { hidden: [...new Set([...prefs.hidden.filter((one) => exists.has(one)), id])], ...open });
    } else throw createError("NOT_FOUND", "That lens isn't on your list.");
    return null;
  },
});
export const removeLens = accountMutation(removeLensAction);
export const removeLensForAssistant = assistantMutation(removeLensAction);

export const setViewAction = defineUserMutation({
  path: "research/overviews:setView",
  description: "Which lens results pages open AI overviews with (`open`, a lens's ID), and whether overviews are folded (`collapsed`): folded, none is written until they're unfolded.",
  args: { open: v.optional(v.string()), collapsed: v.optional(v.boolean()) },
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: false,
  undoable: false,
  run: async (ctx, actor, { open, collapsed }) => {
    if (open !== undefined) await lensFor(ctx, actor, open);
    const prefs = await ownPrefs(ctx, actor);
    await ctx.db.patch("overviewPrefs", prefs._id, { ...(open !== undefined ? { open } : {}), ...(collapsed !== undefined ? { collapsed } : {}) });
    return null;
  },
});
export const setView = accountMutation(setViewAction);
export const setViewForAssistant = assistantMutation(setViewAction);

/**
 * The row, while the run that started at `startedAt` is the one writing it: Write again, or a retry after a run timed
 * out, starts a newer run on the same row, and the older one's writes are dropped.
 */
async function runningRow(ctx: MutationCtx, overviewId: Id<"searchOverviews">, startedAt: number) {
  const row = await ctx.db.get("searchOverviews", overviewId);
  return row?.status === "running" && row.startedAt === startedAt ? row : null;
}

/** What the run reads to write an overview, while it's still the one running: who asked, in which workspace, and whether they pay. */
export const startRun = internalMutation({
  args: { overviewId: v.id("searchOverviews"), startedAt: v.number() },
  returns: v.union(v.null(), v.object({ userId: v.id("users"), workspaceId: v.id("workspaces"), clerkId: v.string(), paid: v.boolean() })),
  handler: async (ctx, { overviewId, startedAt }) => {
    const row = await runningRow(ctx, overviewId, startedAt);
    const user = row ? await ctx.db.get("users", row.askedBy) : null;
    if (!row || !user) return null;
    return { userId: row.askedBy, workspaceId: row.workspaceId, clerkId: user.clerkId, paid: row.paid };
  },
});

/** What the run has done so far, while it's still running: its step, its whole lines, and a count or a list it read. */
export const progress = internalMutation({
  args: { overviewId: v.id("searchOverviews"), startedAt: v.number(), step: v.optional(v.string()), text: v.optional(v.string()), count: v.optional(overviewCountValidator), list: v.optional(overviewListValidator) },
  returns: v.null(),
  handler: async (ctx, { overviewId, startedAt, step, text, count, list }) => {
    const row = await runningRow(ctx, overviewId, startedAt);
    if (!row) return null;
    await ctx.db.patch("searchOverviews", overviewId, {
      ...(step !== undefined ? { step: step.slice(0, 60) } : {}),
      ...(text !== undefined ? { text: text.slice(0, TEXT_MAX) } : {}),
      ...(count && row.counts.length < COUNTS_KEPT ? { counts: [...row.counts, { ...count, groups: count.groups.slice(0, GROUPS_KEPT) }] } : {}),
      ...(list && row.lists.length < LISTS_KEPT ? { lists: [...row.lists, { ...list, papers: list.papers.slice(0, PAPERS_KEPT) }] } : {}),
    });
    return null;
  },
});

/**
 * Ends the run that started at `startedAt` with its text, or with what failed, and says whether it was still the one
 * running. One that failed gives back the overview it counted, on the day it counted it.
 */
async function finish(ctx: MutationCtx, overviewId: Id<"searchOverviews">, startedAt: number, { text, error }: { text?: string; error?: Infer<typeof overviewErrorValidator> }) {
  const row = await runningRow(ctx, overviewId, startedAt);
  if (!row) return false;
  if (error === undefined) {
    await ctx.db.patch("searchOverviews", overviewId, { status: "done", step: undefined, text: (text ?? row.text).slice(0, TEXT_MAX) });
    return true;
  }
  await ctx.db.patch("searchOverviews", overviewId, { status: "failed", step: undefined, error });
  const prefs = await prefsOf(ctx, row.workspaceId, row.askedBy);
  if (prefs && prefs.day === row.day) await ctx.db.patch("overviewPrefs", prefs._id, row.paid ? { paid: Math.max(0, (prefs.paid ?? 1) - 1) } : { free: Math.max(0, (prefs.free ?? 1) - 1) });
  return true;
}

export const finishRun = internalMutation({
  args: { overviewId: v.id("searchOverviews"), startedAt: v.number(), text: v.optional(v.string()), error: v.optional(overviewErrorValidator) },
  returns: v.boolean(),
  handler: async (ctx, { overviewId, startedAt, ...end }) => finish(ctx, overviewId, startedAt, end),
});

/** A run still going RUN_MS after it started has died without saying so: it's ended as failed. A newer run on the row is left alone. */
export const expire = internalMutation({
  args: { overviewId: v.id("searchOverviews"), startedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { overviewId, startedAt }) => {
    await finish(ctx, overviewId, startedAt, { error: "timeout" });
    return null;
  },
});

// `locale` is optional for runs scheduled before it existed; they write in American English.
export const runArgs = { overviewId: v.id("searchOverviews"), startedAt: v.number(), locale: v.optional(localeValidator), request: searchRequestValidator, instruction: v.string(), modelId: v.id("models"), effort: v.optional(effortValidator) };
