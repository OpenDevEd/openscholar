// A live report's registrations with Crossref and Zenodo (plans/publish-reports): what the registering action
// (./registrar.ts) is given and how what it did is kept. A report is registered again whenever what its registrars
// hold has to change (./registering.ts): its details were corrected, or it was withdrawn or reinstated.
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
import { bylineOf, seriesOf } from "../../lib/reports/settings";
import { docidRegistrationValidator, fileAccessValidator, metadataValidator, registrationValidator } from "./validators";

const providerValidator = v.union(v.literal("crossref"), v.literal("zenodo"), v.literal("docid"));
/** Where one registration of a report stands, in its own words: "queued" while it is to be done. */
export const stateOf = (report: Pick<Doc<"reports">, "deposit" | "archive" | "registrations">, provider: "crossref" | "zenodo" | "docid") =>
  provider === "crossref" ? report.deposit : provider === "zenodo" ? report.archive : (report.registrations?.docid?.state ?? "none");

/** Times a registration is tried again by itself when its registrar couldn't be reached, a few minutes apart. */
export const REGISTRATION_TRIES = 5;
const RETRY_AFTER_MS = 3 * 60 * 1000;
/** How long one registering action may hold a report: longer than the action can run, so one that died lets go. */
const LEASE_MS = 12 * 60 * 1000;
/** How soon an action that found the report held looks again. */
const HELD_RETRY_MS = 30 * 1000;
const ERROR_MAX = 500;

/**
 * Hands the registering action a report to register, as it stands: its details, where each registration is, and the
 * registrars' accounts. One action holds a report at a time, so two never make two Zenodo records of it: another
 * that arrives meanwhile looks again shortly. Null when there is nothing for this asking to do.
 */
export const begin = internalMutation({
  args: { reportId: v.id("reports"), rev: v.number() },
  returns: v.union(
    v.null(),
    v.object({
      key: v.string(),
      doi: v.string(),
      withdrawnAt: v.optional(v.number()),
      metadata: metadataValidator,
      series: v.object({ name: v.string(), issn: v.string() }),
      registration: registrationValidator,
      waiting: v.array(providerValidator),
      zenodoRecordId: v.optional(v.string()),
      /** The DOI Zenodo gave it, when it minted its own. */
      zenodoDoi: v.optional(v.string()),
      /** A draft Zenodo already made for this report and never published: it is carried on from, not made again. */
      zenodoDraftId: v.optional(v.string()),
      /** Crossref took this record's deposit, and hasn't shown the record yet. */
      depositSent: v.boolean(),
      /** Whose own Zenodo account it is archived in, when not Openscholar's (#1237). */
      archiveOwnerId: v.optional(v.id("users")),
      /** Who may get its file, which Zenodo keeps private, or private until a day, when not anyone. */
      fileAccess: v.optional(fileAccessValidator),
      pdf: v.union(v.null(), v.object({ file: v.id("_storage"), name: v.string(), pages: v.optional(v.number()) })),
      /** Its cover, which DOCiD shows as the record's poster. */
      cover: v.optional(v.id("_storage")),
      /** Where its DOCiD stands: its Handle and DOCiD's record of it, once each exists. */
      docid: v.optional(docidRegistrationValidator),
      publication: publicationSettingsValidator,
      encryptedCredentials: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, { reportId, rev }) => {
    const report = await ctx.db.get("reports", reportId);
    // Only a report that has gone live has anything registered: live, or withdrawn since. And only its latest asking is done.
    if (!report || report.activatedAt === undefined || report.registrationRev !== rev) return null;
    const now = Date.now();
    if (report.registrationLease !== undefined && report.registrationLease > now) {
      await ctx.scheduler.runAfter(HELD_RETRY_MS, internal.reports.registrar.register, { reportId, rev });
      return null;
    }
    const { metadata } = await detailsOf(ctx, reportId);
    // In the order they happen, and only those still to do.
    const waiting = providersOf(report.registration).filter((provider) => stateOf(report, provider) === "queued");
    if (!metadata || !waiting.length) return null;
    await ctx.db.patch("reports", reportId, { registrationLease: now + LEASE_MS });
    // An action that dies holding the report leaves nothing behind to try again: one more is asked for when its hold
    // runs out, which finds nothing to do if this one finished.
    await ctx.scheduler.runAfter(LEASE_MS + HELD_RETRY_MS, internal.reports.registrar.register, { reportId, rev });
    const settings = await reportSettings(ctx);
    return {
      key: report.key,
      doi: report.doi,
      ...(report.withdrawnAt !== undefined && { withdrawnAt: report.withdrawnAt }),
      metadata,
      series: seriesOf(report, settings.series),
      registration: report.registration,
      waiting,
      ...(report.zenodoRecordId && { zenodoRecordId: report.zenodoRecordId }),
      ...(report.zenodoDoi && { zenodoDoi: report.zenodoDoi }),
      ...(report.zenodoDraftId && { zenodoDraftId: report.zenodoDraftId }),
      depositSent: report.depositSent === true,
      ...(report.fileAccess && { fileAccess: report.fileAccess }),
      ...(report.archiveOwnerId && { archiveOwnerId: report.archiveOwnerId }),
      pdf: report.pdf ? { file: report.pdf.file, name: report.pdf.name, ...(report.pdf.pages !== undefined && { pages: report.pdf.pages }) } : null,
      ...(report.cover && { cover: report.cover.file }),
      ...(report.registrations?.docid && { docid: report.registrations.docid }),
      publication: settings.publication,
      encryptedCredentials: settings.row?.encryptedCredentials ?? null,
    };
  },
});

/** The action is done with the report, whatever happened: the next one may take it. */
export const end = internalMutation({
  args: { reportId: v.id("reports") },
  returns: v.null(),
  handler: async (ctx, { reportId }) => {
    if (await ctx.db.get("reports", reportId)) await ctx.db.patch("reports", reportId, { registrationLease: undefined });
    return null;
  },
});

/**
 * What a registrar did part-way, kept the moment it happens so a later failure never makes it happen twice:
 * Crossref took the deposit (it is then looked for, not sent again), or Zenodo made a draft (it is carried on from).
 */
export const noted = internalMutation({
  args: { reportId: v.id("reports"), rev: v.number(), depositSent: v.optional(v.boolean()), zenodoDraftId: v.optional(v.string()), docidHandle: v.optional(v.string()), docidPublicationId: v.optional(v.number()), docidRetired: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, { reportId, rev, depositSent, zenodoDraftId, docidHandle, docidPublicationId, docidRetired }) => {
    const report = await ctx.db.get("reports", reportId);
    if (!report) return null;
    // A draft is the report's whichever asking made it; a deposit is of the record as that asking had it.
    await ctx.db.patch("reports", reportId, { ...(zenodoDraftId && { zenodoDraftId }), ...(depositSent && report.registrationRev === rev && { depositSent: true }) });
    // A DOCiD and its record are the report's whichever asking made them: kept at once, never made twice. A Handle
    // is part of what the report's page and the search index show, so it counts as a change.
    if (docidHandle !== undefined || docidPublicationId !== undefined || docidRetired !== undefined) {
      const docid = report.registrations?.docid ?? { state: "queued" as const };
      const kept = { registrations: { ...report.registrations, docid: { ...docid, ...(docidHandle && { handle: docidHandle }), ...(docidPublicationId !== undefined && { publicationId: docidPublicationId }), ...(docidRetired !== undefined && { retired: docidRetired }) } } };
      if (docidHandle && docidHandle !== docid.handle) await touch(ctx, report, kept);
      else await ctx.db.patch("reports", reportId, kept);
    }
    return null;
  },
});

/**
 * Keeps what one registrar answered. `done` moves on to the next; `refused` stops there and tells the team's inbox;
 * `unreached` tries again in a few minutes, a few times, then counts as refused. Answers whether the action goes on
 * to the next registrar: not after anything but `done`, and not for an asking that a newer one replaced.
 */
export const settle = internalMutation({
  args: { reportId: v.id("reports"), rev: v.number(), provider: providerValidator, outcome: v.union(v.literal("done"), v.literal("refused"), v.literal("unreached")), error: v.optional(v.string()), zenodoRecordId: v.optional(v.string()), zenodoDoi: v.optional(v.string()) },
  returns: v.boolean(),
  handler: async (ctx, { reportId, rev, provider, outcome, error, zenodoRecordId, zenodoDoi }) => {
    const report = await ctx.db.get("reports", reportId);
    if (!report) return false;
    // Zenodo's record is the report's whichever asking made it: kept even when a newer asking has replaced this one.
    if (zenodoRecordId && report.zenodoRecordId !== zenodoRecordId) {
      const kept = { zenodoRecordId, zenodoDraftId: undefined, ...(zenodoDoi && { zenodoDoi }) };
      // A DOI Zenodo minted is part of what the search index holds of the report (./searchIndex.ts): it counts as a change.
      if (zenodoDoi && zenodoDoi !== report.zenodoDoi) await touch(ctx, report, kept);
      else await ctx.db.patch("reports", reportId, kept);
    }
    // Asked to register again since this attempt began: this answer is about an older record.
    if (report.registrationRev !== rev || stateOf(report, provider) !== "queued") return false;
    const mark = (state: "done" | "failed") => (provider === "docid" ? { registrations: { ...report.registrations, docid: { ...report.registrations?.docid, state: state === "done" ? ("registered" as const) : ("failed" as const) } } } : { [provider === "crossref" ? "deposit" : "archive"]: state === "failed" ? "failed" : provider === "crossref" ? "deposited" : "archived" });
    if (outcome === "done") {
      await ctx.db.patch("reports", reportId, { ...mark("done"), registrationError: undefined, registrationTries: undefined, ...(provider === "crossref" && { depositSent: undefined }) });
      return true;
    }
    const tries = (report.registrationTries ?? 0) + 1;
    if (outcome === "unreached" && tries < REGISTRATION_TRIES) {
      await ctx.db.patch("reports", reportId, { registrationTries: tries, ...(error && { registrationError: error.slice(0, ERROR_MAX) }) });
      await ctx.scheduler.runAfter(RETRY_AFTER_MS, internal.reports.registrar.register, { reportId, rev });
      return false;
    }
    await ctx.db.patch("reports", reportId, { ...mark("failed"), registrationTries: undefined, registrationError: (error ?? "The registrar refused it.").slice(0, ERROR_MAX) });
    await notify(ctx, reportId, "registration-refused");
    return false;
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
    if (report.deposit !== "failed" && report.archive !== "failed" && report.registrations?.docid?.state !== "failed") throw createError("CONFLICT", "Nothing was refused: its registrations are done or under way.");
    await registerAgain(ctx, report);
    return null;
  },
});

/**
 * Sends a report again to what refused it, and what waited behind it: what was already registered stays as it is. A
 * new asking, so nothing still running for the old one is taken for it.
 */
export async function registerAgain(ctx: MutationCtx, report: Doc<"reports">) {
  const registers = providersOf(report.registration);
  const again = (at: string, done: string) => (at === done ? done : "queued");
  const rev = (report.registrationRev ?? 0) + 1;
  await touch(ctx, report, {
    ...(registers.includes("crossref") && { deposit: again(report.deposit, "deposited") as Doc<"reports">["deposit"] }),
    ...(registers.includes("zenodo") && { archive: again(report.archive, "archived") as Doc<"reports">["archive"] }),
    ...(registers.includes("docid") && { registrations: { ...report.registrations, docid: { ...report.registrations?.docid, state: again(report.registrations?.docid?.state ?? "none", "registered") as "registered" | "queued" } } }),
    registrationRev: rev,
    registrationError: undefined,
    registrationTries: undefined,
    // Sent again whole: a deposit Crossref took and never showed is not waited on any longer.
    depositSent: undefined,
  });
  await ctx.scheduler.runAfter(0, internal.reports.registrar.register, { reportId: report._id, rev });
}

/**
 * What minting at signing needs (plans/identifier-services): the report's key, its DOCiD so far and the DOCiD
 * account. Null for a report that no longer gets one, or already has its Handle.
 */
export const toMint = internalQuery({
  args: { reportId: v.id("reports") },
  returns: v.union(v.null(), v.object({ key: v.string(), publication: publicationSettingsValidator, encryptedCredentials: v.union(v.string(), v.null()) })),
  handler: async (ctx, { reportId }) => {
    const report = await ctx.db.get("reports", reportId);
    if (!report?.registration.docid || report.registrations?.docid?.handle) return null;
    const settings = await reportSettings(ctx);
    return { key: report.key, publication: settings.publication, encryptedCredentials: settings.row?.encryptedCredentials ?? null };
  },
});

/** Keeps the Handle DOCiD minted at signing and, when the report cites it, puts it in the line its PDF carries. */
export const mintedAtSigning = internalMutation({
  args: { reportId: v.id("reports"), handle: v.string() },
  returns: v.null(),
  handler: async (ctx, { reportId, handle }) => {
    const report = await ctx.db.get("reports", reportId);
    if (!report || report.registrations?.docid?.handle) return null;
    const settings = await reportSettings(ctx);
    const cites = report.registration.cited === "docid" || !report.doi;
    await touch(ctx, report, {
      registrations: { ...report.registrations, docid: { state: report.registrations?.docid?.state ?? "none", handle } },
      registrationError: undefined,
      ...(cites && report.licence && { byline: bylineOf({ ...settings.series, ...seriesOf(report, settings.series) }, `https://hdl.handle.net/${handle}`, report.licence) }),
    });
    return null;
  },
});

/** DOCiD refused minting at signing: the author is told why on the report, and can ask again. */
export const mintRefused = internalMutation({
  args: { reportId: v.id("reports"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, { reportId, error }) => {
    const report = await ctx.db.get("reports", reportId);
    if (report && !report.registrations?.docid?.handle) await ctx.db.patch("reports", reportId, { registrationError: error.slice(0, ERROR_MAX) });
    return null;
  },
});
