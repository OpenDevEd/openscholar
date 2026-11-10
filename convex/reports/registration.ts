// A live report's registrations with Crossref and Zenodo (plans/publish-reports): what the registering action
// (./registrar.ts) reads and how what it did is kept. A report is registered again whenever what its registrars hold
// has to change: its details were corrected, or it was withdrawn or reinstated.
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, internalQuery, mutation, type MutationCtx } from "../lib/functions";
import { requireAdmin } from "../admins/access";
import { refuseApps } from "../lib/auth";
import { createError } from "../lib/errors";
import { publicationSettingsValidator } from "../evidenceLibraries/publicationValidators";
import { providersOf } from "../../lib/reports/report";
import { detailsOf, touch } from "./flow";
import { notify } from "./mail";
import { reportSettings } from "./settings";
import { metadataValidator, registrationValidator } from "./validators";

const providerValidator = v.union(v.literal("crossref"), v.literal("zenodo"));
/** Times a registration is tried again by itself when its registrar couldn't be reached, a few minutes apart. */
export const REGISTRATION_TRIES = 5;
const RETRY_AFTER_MS = 3 * 60 * 1000;
const ERROR_MAX = 500;

/** Sends a report to its registrars as it now stands: each of them takes it again. */
export async function register(ctx: MutationCtx, report: Doc<"reports">) {
  const registers = providersOf(report.registration);
  await ctx.db.patch("reports", report._id, {
    deposit: registers.includes("crossref") ? "queued" : "none",
    archive: registers.includes("zenodo") ? "queued" : "none",
    registrationError: undefined,
    registrationTries: undefined,
  });
  await ctx.scheduler.runAfter(0, internal.reports.registrar.register, { reportId: report._id });
}

/** What the registering action sends: the report as it stands, where each registration is, and the registrars' accounts. */
export const job = internalQuery({
  args: { reportId: v.id("reports") },
  returns: v.union(
    v.null(),
    v.object({
      key: v.string(),
      doi: v.string(),
      withdrawn: v.boolean(),
      metadata: metadataValidator,
      series: v.object({ name: v.string(), issn: v.string() }),
      registration: registrationValidator,
      waiting: v.array(providerValidator),
      zenodoRecordId: v.optional(v.string()),
      zenodoDoi: v.optional(v.string()),
      pdf: v.union(v.null(), v.object({ file: v.id("_storage"), name: v.string() })),
      publication: publicationSettingsValidator,
      encryptedCredentials: v.union(v.string(), v.null()),
      tries: v.number(),
    }),
  ),
  handler: async (ctx, { reportId }) => {
    const report = await ctx.db.get("reports", reportId);
    // Only a report that has gone live has anything registered: live, or withdrawn since.
    if (!report || report.activatedAt === undefined) return null;
    const { metadata } = await detailsOf(ctx, reportId);
    if (!metadata) return null;
    const settings = await reportSettings(ctx);
    return {
      key: report.key,
      doi: report.doi,
      withdrawn: report.withdrawnAt !== undefined,
      metadata,
      series: { name: settings.series.name, issn: settings.series.issn },
      registration: report.registration,
      // In the order they happen, and only those still to do.
      waiting: providersOf(report.registration).filter((provider) => (provider === "crossref" ? report.deposit : report.archive) === "queued"),
      ...(report.zenodoRecordId && { zenodoRecordId: report.zenodoRecordId }),
      ...(report.zenodoDoi && { zenodoDoi: report.zenodoDoi }),
      pdf: report.pdf ? { file: report.pdf.file, name: report.pdf.name } : null,
      publication: settings.publication,
      encryptedCredentials: settings.row?.encryptedCredentials ?? null,
      tries: report.registrationTries ?? 0,
    };
  },
});

/**
 * Keeps what one registrar answered. `done` moves on to the next; `refused` stops there and tells the team's inbox;
 * `unreached` tries again in a few minutes, a few times, then counts as refused.
 */
export const settle = internalMutation({
  args: { reportId: v.id("reports"), provider: providerValidator, outcome: v.union(v.literal("done"), v.literal("refused"), v.literal("unreached")), error: v.optional(v.string()), zenodoRecordId: v.optional(v.string()), zenodoDoi: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { reportId, provider, outcome, error, zenodoRecordId, zenodoDoi }) => {
    const report = await ctx.db.get("reports", reportId);
    // Asked to register again since this attempt began, or gone: this answer is about an older record.
    if (!report || (provider === "crossref" ? report.deposit : report.archive) !== "queued") return null;
    const field = provider === "crossref" ? "deposit" : "archive";
    if (outcome === "done") {
      await ctx.db.patch("reports", reportId, { [field]: provider === "crossref" ? "deposited" : "archived", registrationError: undefined, registrationTries: undefined, ...(zenodoRecordId && { zenodoRecordId }), ...(zenodoDoi && { zenodoDoi }) });
      return null;
    }
    const tries = (report.registrationTries ?? 0) + 1;
    if (outcome === "unreached" && tries < REGISTRATION_TRIES) {
      await ctx.db.patch("reports", reportId, { registrationTries: tries, ...(error && { registrationError: error.slice(0, ERROR_MAX) }) });
      await ctx.scheduler.runAfter(RETRY_AFTER_MS, internal.reports.registrar.register, { reportId });
      return null;
    }
    await ctx.db.patch("reports", reportId, { [field]: "failed", registrationTries: undefined, registrationError: (error ?? "The registrar refused it.").slice(0, ERROR_MAX), ...(zenodoRecordId && { zenodoRecordId }) });
    await notify(ctx, reportId, "registration-refused");
    return null;
  },
});

/** A reviewer sends a report whose registration was refused to its registrars again. */
export const retry = mutation({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, { key }) => {
    await refuseApps(ctx);
    await requireAdmin(ctx);
    const report = await ctx.db.query("reports").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (!report || report.activatedAt === undefined) throw createError("NOT_FOUND", "This report isn't live, so it has nothing registered.");
    if (report.deposit !== "failed" && report.archive !== "failed") throw createError("CONFLICT", "Nothing was refused: its registrations are done or under way.");
    // What was already registered stays as it is: only what was refused, and what waited behind it, is sent.
    const registers = providersOf(report.registration);
    const again = (at: string, done: string) => (at === done ? done : "queued");
    await touch(ctx, report, {
      ...(registers.includes("crossref") && { deposit: again(report.deposit, "deposited") as Doc<"reports">["deposit"] }),
      ...(registers.includes("zenodo") && { archive: again(report.archive, "archived") as Doc<"reports">["archive"] }),
      registrationError: undefined,
      registrationTries: undefined,
    });
    await ctx.scheduler.runAfter(0, internal.reports.registrar.register, { reportId: report._id });
    return null;
  },
});
