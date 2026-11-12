// Openscholar Reports' settings (plans/publish-reports): whether publishing is on, whether a person reviews every
// report, the series, the model that reads a PDF's details, the checks and the agreement. Admins change them at
// Settings > Admin > Publishing. Registrar accounts are saved by ./publicationActions.ts.
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { mutation, query, type MutationCtx, type QueryCtx } from "../lib/functions";
import { requireAdmin } from "../admins/access";
import { refuseApps } from "../lib/auth";
import { createError } from "../lib/errors";
import { modelSummary, slugPick } from "../ai/serverModel";
import { requireAvailableModel, requireEffort, requireTaskModel } from "../models/catalog";
import { effortValidator, modelSummaryValidator } from "../aiModelConfig/validators";
import { keptCustomOf, keptCustomValidator, publicationSettingsValidator } from "../evidenceLibraries/publicationValidators";
import type { Effort } from "../../lib/ai/core/call-options";
import { AGREEMENT_MAX, CHECK_NAME_MAX, CHECK_TEXT_MAX, MAX_CHECKS, REPORT_DEFAULTS, SERIES_TEXT_MAX, canRegister, isIssn, type Check } from "../../lib/reports/settings";
import { checkNamesValidator, checkSummariesValidator, seriesValidator } from "./validators";

/** What a check runs as: a decision model answers it, or an LLM that returns a structured answer. */
const CHECK_TASK = "screening";
/** What reading a PDF's details runs as. */
const READING_TASK = "extraction";

/** The settings as they are: the one row, over what the series starts with. */
export async function reportSettings(ctx: QueryCtx) {
  const row = await ctx.db.query("reportSettings").first();
  return { ...REPORT_DEFAULTS, metadataEffort: REPORT_DEFAULTS.metadataEffort as Effort | undefined, ...row, row };
}

/**
 * The settings row, made from the defaults the first time anything is saved, with the versions of the checks and
 * the agreement that a report started from then on records.
 */
export async function settingsRow(ctx: MutationCtx) {
  const row = await ctx.db.query("reportSettings").first();
  if (row) return row;
  const { checks, checksVersion, agreement } = REPORT_DEFAULTS;
  await ctx.db.insert("reportCheckVersions", { version: checksVersion, checks });
  await ctx.db.insert("reportAgreementVersions", { version: agreement.version, text: agreement.text });
  const id = await ctx.db.insert("reportSettings", { ...REPORT_DEFAULTS, updatedAt: Date.now() });
  return (await ctx.db.get("reportSettings", id))!;
}

const save = (ctx: MutationCtx, id: Awaited<ReturnType<typeof settingsRow>>["_id"], fields: Partial<Omit<Awaited<ReturnType<typeof settingsRow>>, "_id" | "_creationTime">>) =>
  ctx.db.patch("reportSettings", id, { ...fields, updatedAt: Date.now() });

/** Text an admin typed, trimmed, refused when it is empty or longer than its box allows. */
function text(value: string, what: string, max: number, { empty = false } = {}) {
  const trimmed = value.trim();
  if (!trimmed && !empty) throw createError("VALIDATION_ERROR", `Enter ${what}.`);
  if (trimmed.length > max) throw createError("VALIDATION_ERROR", `Keep ${what} to ${max.toLocaleString("en")} characters.`);
  return trimmed;
}

/** The byline with `{doi}` in it: the line each PDF must carry is how a reader of the PDF finds the report, and what the byline check looks for. */
function byline(typed: string) {
  const kept = text(typed, "the byline", SERIES_TEXT_MAX);
  if (!kept.includes("{doi}")) throw createError("VALIDATION_ERROR", "The byline needs {doi} in it, which becomes each report's DOI.");
  return kept;
}

/** An ISSN as typed, upper case, or none: anything else would be printed on every report's byline. */
function issn(value: string) {
  const typed = value.trim().toUpperCase();
  if (typed && !isIssn(typed)) throw createError("VALIDATION_ERROR", "That isn't an ISSN. One looks like 2049-3630, and its last digit is a check on the rest.");
  return typed;
}

/** Everything the admin's Settings shows. A check's or the reader's `model` is null when its model has left the catalog. */
export const admin = query({
  args: {},
  returns: v.object({
    enabled: v.boolean(),
    humanReview: v.boolean(),
    series: seriesValidator,
    publication: publicationSettingsValidator,
    publicationSavedAt: v.union(v.number(), v.null()),
    publicationCustom: keptCustomValidator,
    metadataModel: v.union(modelSummaryValidator, v.null()),
    metadataEffort: v.optional(effortValidator),
    checks: checkSummariesValidator,
    checksVersion: v.number(),
    agreement: v.object({ version: v.number(), text: v.string(), updatedAt: v.union(v.number(), v.null()) }),
  }),
  handler: async (ctx) => {
    await refuseApps(ctx);
    await requireAdmin(ctx);
    const settings = await reportSettings(ctx);
    const reader = await slugPick(ctx, settings.metadataModelId, settings.metadataEffort, READING_TASK);
    return {
      enabled: settings.enabled,
      humanReview: settings.humanReview,
      series: settings.series,
      publication: settings.publication,
      publicationSavedAt: settings.row?.publicationSavedAt ?? null,
      publicationCustom: keptCustomOf(settings.publication, settings.row?.customAccounts),
      metadataModel: await modelSummary(ctx, reader?.modelId ?? null),
      ...(reader?.effort && { metadataEffort: reader.effort }),
      checks: await Promise.all(
        settings.checks.map(async (check) => {
          const pick = await slugPick(ctx, check.modelId, check.effort, CHECK_TASK);
          // The effort the model still takes, which may no longer be the one saved.
          const { effort: _saved, ...kept } = check;
          return { ...kept, ...(pick?.effort && { effort: pick.effort }), model: await modelSummary(ctx, pick?.modelId ?? null) };
        }),
      ),
      checksVersion: settings.checksVersion,
      agreement: { version: settings.agreement.version, text: settings.agreement.text, updatedAt: settings.row?.agreement.updatedAt ?? null },
    };
  },
});

/** Whether publishing is open: the sidebar's Publish item, on every page. */
export const open = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const settings = await reportSettings(ctx);
    return settings.enabled && canRegister(settings.publication);
  },
});

/**
 * What the Publish page reads, signed in or not: whether publishing is open, the series, the
 * agreement to sign, and the checks a report runs, by name. Nothing here is an admin's alone: no account, no model,
 * no question, no limit of anyone's.
 */
export const forAuthors = query({
  args: {},
  returns: v.object({
    open: v.boolean(),
    humanReview: v.boolean(),
    series: seriesValidator,
    agreement: v.object({ version: v.number(), text: v.string() }),
    checks: checkNamesValidator,
  }),
  handler: async (ctx) => {
    const settings = await reportSettings(ctx);
    return {
      open: settings.enabled && canRegister(settings.publication),
      humanReview: settings.humanReview,
      series: settings.series,
      agreement: { version: settings.agreement.version, text: settings.agreement.text },
      checks: settings.checks.filter((check) => check.enabled).map(({ id, name, blocking }) => ({ id, name, blocking })),
    };
  },
});

/** The switches and the series. Only what is given changes. */
export const update = mutation({
  args: {
    enabled: v.optional(v.boolean()),
    humanReview: v.optional(v.boolean()),
    // Each part on its own, so two boxes saved one after the other never undo each other.
    series: v.optional(seriesValidator.partial()),
  },
  returns: v.null(),
  handler: async (ctx, { enabled, humanReview, series }) => {
    await refuseApps(ctx);
    await requireAdmin(ctx);
    const row = await settingsRow(ctx);
    // Review switched off releases what waited only for it (./review.ts `release`).
    if (humanReview === false && row.humanReview) {
      await ctx.scheduler.runAfter(0, internal.reports.review.release, {});
      await ctx.scheduler.runAfter(0, internal.reports.review.tellReleased, {});
    }
    await save(ctx, row._id, {
      ...(enabled !== undefined && { enabled }),
      ...(humanReview !== undefined && { humanReview }),
      ...(series && {
        series: {
          ...row.series,
          ...(series.name !== undefined && { name: text(series.name, "the series' name", SERIES_TEXT_MAX) }),
          // None until the ISSN centre assigns one: the byline then reads "pending".
          ...(series.issn !== undefined && { issn: issn(series.issn) }),
          ...(series.byline !== undefined && { byline: byline(series.byline) }),
        },
      }),
    });
    return null;
  },
});

/** The model that reads a PDF's details, and the effort it reads at. */
export const setMetadataModel = mutation({
  args: { modelId: v.id("models"), effort: v.optional(effortValidator) },
  returns: v.null(),
  handler: async (ctx, { modelId, effort }) => {
    await refuseApps(ctx);
    await requireAdmin(ctx);
    const model = await requireAvailableModel(ctx, modelId);
    requireEffort(model, effort);
    requireTaskModel(model, READING_TASK);
    const row = await settingsRow(ctx);
    await save(ctx, row._id, { metadataModelId: model.modelId, metadataEffort: effort });
    return null;
  },
});

/** A changed set of checks is a new version: a report keeps the version it ran. */
async function saveChecks(ctx: MutationCtx, row: Awaited<ReturnType<typeof settingsRow>>, checks: Check[]) {
  const checksVersion = row.checksVersion + 1;
  await ctx.db.insert("reportCheckVersions", { version: checksVersion, checks });
  await save(ctx, row._id, { checks, checksVersion });
}

/** Adds a check, or changes the one with `id`. A new one goes last. */
export const saveCheck = mutation({
  args: {
    id: v.optional(v.string()),
    name: v.string(),
    question: v.string(),
    fix: v.optional(v.string()),
    modelId: v.id("models"),
    effort: v.optional(effortValidator),
    threshold: v.number(),
    blocking: v.boolean(),
    enabled: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, { id, modelId, effort, threshold, blocking, enabled, ...words }) => {
    await refuseApps(ctx);
    await requireAdmin(ctx);
    const model = await requireAvailableModel(ctx, modelId);
    requireEffort(model, effort);
    requireTaskModel(model, CHECK_TASK);
    if (!(threshold >= 0 && threshold <= 1)) throw createError("VALIDATION_ERROR", "A check's threshold is from 0 to 100%.");
    const row = await settingsRow(ctx);
    const at = id === undefined ? -1 : row.checks.findIndex((check) => check.id === id);
    if (id !== undefined && at < 0) throw createError("NOT_FOUND", "That check is no longer there.");
    if (at < 0 && row.checks.length >= MAX_CHECKS) throw createError("VALIDATION_ERROR", `The series holds at most ${MAX_CHECKS} checks.`);
    const fix = words.fix === undefined ? "" : text(words.fix, "the advice", CHECK_TEXT_MAX, { empty: true });
    const check: Check = {
      // A version only ever adds one check, so its number names it.
      id: id ?? `check-${row.checksVersion + 1}`,
      name: text(words.name, "the check's name", CHECK_NAME_MAX),
      question: text(words.question, "the question", CHECK_TEXT_MAX),
      ...(fix && { fix }),
      modelId: model.modelId,
      ...(effort && { effort }),
      threshold,
      blocking,
      enabled,
      // What a check searches for stays what it was: only its words, model and switches are an admin's to change.
      ...(at >= 0 && row.checks[at]!.builtIn && { builtIn: row.checks[at]!.builtIn }),
    };
    await saveChecks(ctx, row, at < 0 ? [...row.checks, check] : row.checks.map((kept, i) => (i === at ? check : kept)));
    return null;
  },
});

/** Switches a check on or off, which is a new version like any other change to the checks. */
export const switchCheck = mutation({
  args: { id: v.string(), enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { id, enabled }) => {
    await refuseApps(ctx);
    await requireAdmin(ctx);
    const row = await settingsRow(ctx);
    const check = row.checks.find((kept) => kept.id === id);
    if (!check) throw createError("NOT_FOUND", "That check is no longer there.");
    if (check.enabled !== enabled) await saveChecks(ctx, row, row.checks.map((kept) => (kept.id === id ? { ...kept, enabled } : kept)));
    return null;
  },
});

/** Takes a check out. The built-in one can only be switched off. */
export const removeCheck = mutation({
  args: { id: v.string() },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await refuseApps(ctx);
    await requireAdmin(ctx);
    const row = await settingsRow(ctx);
    const check = row.checks.find((kept) => kept.id === id);
    if (!check) return null;
    if (check.builtIn) throw createError("VALIDATION_ERROR", `${check.name} is built in. Switch it off instead.`);
    await saveChecks(ctx, row, row.checks.filter((kept) => kept.id !== id));
    return null;
  },
});

/** The agreement authors sign from now on. The text people already signed stays with its version. */
export const setAgreement = mutation({
  args: { text: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await refuseApps(ctx);
    await requireAdmin(ctx);
    const agreed = text(args.text, "the agreement", AGREEMENT_MAX);
    const row = await settingsRow(ctx);
    if (agreed === row.agreement.text) return null;
    const version = row.agreement.version + 1;
    await ctx.db.insert("reportAgreementVersions", { version, text: agreed });
    await save(ctx, row._id, { agreement: { version, text: agreed, updatedAt: Date.now() } });
    return null;
  },
});
