// What the reports' emails are written from, and the record of each one sent (plans/publish-reports). The mutation
// where something happens calls `notify`; ./mailer.ts writes the email from the report as it then stands and sends it.
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "../lib/functions";
import { changesOf } from "../../lib/reports/report";
import { MAIL_EVENTS, type MailEvent } from "../../lib/reports/emails";
import { detailsOf } from "./flow";
import { checkResultsValidator, mailAudienceValidator } from "./validators";

export const mailEventValidator = v.union(...MAIL_EVENTS.map((event) => v.literal(event)));
/** The longest email kept on a report's record: a failed check's reasons can run long. */
const TEXT_KEPT = 20_000;

/** Writes to the team's inbox or the report's author about what just happened to it. `edited` is what a reviewer changed, for the email that says so. */
export const notify = (ctx: MutationCtx, reportId: Id<"reports">, event: MailEvent, edited?: string) =>
  ctx.scheduler.runAfter(0, internal.reports.mailer.send, { reportId, event, ...(edited && { edited }) });

/** A report as its emails describe it; null once it is gone. */
export const facts = internalQuery({
  args: { reportId: v.id("reports") },
  returns: v.union(
    v.null(),
    v.object({
      key: v.string(),
      doi: v.string(),
      title: v.string(),
      activated: v.boolean(),
      live: v.boolean(),
      signer: v.string(),
      authorEmail: v.union(v.string(), v.null()),
      pdfName: v.optional(v.string()),
      results: checkResultsValidator,
      request: v.optional(v.string()),
      note: v.optional(v.string()),
      correction: v.optional(v.object({ changed: v.array(v.string()), results: checkResultsValidator, request: v.optional(v.string()), declinedNote: v.optional(v.string()) })),
      deposit: v.string(),
      archive: v.string(),
    }),
  ),
  handler: async (ctx, { reportId }) => {
    const report = await ctx.db.get("reports", reportId);
    if (!report) return null;
    const details = await detailsOf(ctx, reportId);
    const owner = await ctx.db.get("users", report.ownerId);
    const changes = details.correction;
    return {
      key: report.key,
      doi: report.doi,
      title: details.metadata?.title || report.pdf?.name || report.key,
      activated: report.activatedAt !== undefined,
      live: report.status === "live",
      signer: report.signedBy.name,
      authorEmail: owner?.state === "active" ? owner.email : null,
      ...(report.pdf && { pdfName: report.pdf.name }),
      results: details.results ?? [],
      ...(details.reviewRequest && { request: details.reviewRequest.comment }),
      ...(report.note && { note: report.note }),
      ...(changes && {
        correction: {
          changed: details.metadata ? changesOf(details.metadata, changes.metadata).map((change) => change.label) : [],
          results: changes.results,
          ...(changes.request && { request: changes.request.comment }),
          ...(changes.declined?.note && { declinedNote: changes.declined.note }),
        },
      }),
      deposit: report.deposit,
      archive: report.archive,
    };
  },
});

/** Keeps an email on its report's record: what it was, who it went to, and why it didn't go if it didn't. */
export const sent = internalMutation({
  args: { reportId: v.id("reports"), event: v.string(), audience: mailAudienceValidator, subject: v.string(), text: v.string(), error: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { text, ...email }) => {
    if (await ctx.db.get("reports", email.reportId)) await ctx.db.insert("reportEmails", { ...email, text: text.slice(0, TEXT_KEPT), at: Date.now() });
    return null;
  },
});
