// What the reports' emails are written from, and the record of each one sent (plans/publish-reports). The mutation
// where something happens calls `notify`; ./mailer.ts writes the email from the report as it then stands and sends it.
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../lib/functions";
import { changesOf } from "../../lib/reports/report";
import { MAIL_EVENTS, type MailEvent } from "../../lib/reports/emails";
import { detailsOf } from "./flow";
import { checkResultsValidator, mailAudienceValidator } from "./validators";

export const mailEventValidator = v.union(...MAIL_EVENTS.map((event) => v.literal(event)));
/** The longest email kept on a report's record: a failed check's reasons can run long. */
const TEXT_KEPT = 20_000;

const factsValidator = v.object({
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
  edited: v.optional(v.string()),
  admins: v.optional(v.object({ emails: v.array(v.string()), organization: v.string(), prefix: v.string() })),
  refund: v.optional(v.object({ card: v.number(), credit: v.number() })),
});
export const mailArgs = { reportId: v.id("reports"), event: mailEventValidator, report: factsValidator };

/**
 * Writes to the team's inbox or the report's author about what just happened to it. The email says what the report
 * was at that moment, read here and handed to the action that sends it: a note discarded or a correction replaced a
 * second later is never what it quotes. `edited` is what a reviewer changed, for the email that says so, and `refund`
 * what an activation's refund gave back.
 */
export async function notify(ctx: MutationCtx, reportId: Id<"reports">, event: MailEvent, { edited, refund }: { edited?: string; refund?: { card: number; credit: number } } = {}) {
  const report = await ctx.db.get("reports", reportId);
  if (!report) return;
  const details = await detailsOf(ctx, reportId);
  const owner = await ctx.db.get("users", report.ownerId);
  const changes = details.correction;
  await ctx.scheduler.runAfter(0, internal.reports.mailer.send, {
    reportId,
    event,
    report: {
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
      ...(edited && { edited }),
      ...(refund && { refund }),
      // An organisation's report is activated by its admins: its author's emails say so too, and name it.
      ...((event === "waiting-for-admin" || event === "refunded-admins" || event === "approved" || event === "released") && { admins: await adminsOf(ctx, report.workspaceId) }),
    },
  });
}

/** The most admins an organisation's email about a report goes to. */
const ADMINS_WRITTEN = 20;

/** The addresses of the active admins of the organisation a workspace is, its name, and where its pages are. */
async function adminsOf(ctx: MutationCtx, workspaceId: Id<"workspaces">) {
  const workspace = await ctx.db.get("workspaces", workspaceId);
  const organization = workspace?.kind === "organization" ? await ctx.db.get("organizations", workspace.organizationId) : null;
  if (!organization) return undefined;
  const memberships = await ctx.db
    .query("organizationMemberships")
    .withIndex("by_organizationId_and_state_and_role", (q) => q.eq("organizationId", organization._id).eq("state", "active").eq("role", "org:admin"))
    .take(ADMINS_WRITTEN);
  const people = await Promise.all(memberships.map((membership) => ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", membership.clerkUserId)).unique()));
  return { emails: people.flatMap((person) => (person?.state === "active" ? [person.email] : [])), organization: organization.name, prefix: `/o/${organization.slug}` };
}

/**
 * What a report reaching "Ready to activate" sets off (#1261): the workspace's card is read again, so the page offers
 * the card it has; and when the report's owner can't activate it themselves (an organisation's member), its admins
 * are told it waits for them.
 */
export async function becameReady(ctx: MutationCtx, reportId: Id<"reports">) {
  const report = await ctx.db.get("reports", reportId);
  if (!report) return;
  await ctx.scheduler.runAfter(0, internal.billing.accounts.refresh, { workspaceId: report.workspaceId, card: true });
  const workspace = await ctx.db.get("workspaces", report.workspaceId);
  if (workspace?.kind !== "organization") return;
  const owner = await ctx.db.get("users", report.ownerId);
  const membership = owner && (await ctx.db.query("organizationMemberships").withIndex("by_organizationId_and_clerkUserId_and_state", (q) => q.eq("organizationId", workspace.organizationId).eq("clerkUserId", owner.clerkId).eq("state", "active")).first());
  if (membership?.role !== "org:admin") await notify(ctx, reportId, "waiting-for-admin");
}

/** Keeps an email on its report's record: what it was, who it went to, and why it didn't go if it didn't. */
export const sent = internalMutation({
  args: { reportId: v.id("reports"), event: v.string(), audience: mailAudienceValidator, subject: v.string(), text: v.string(), error: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { text, ...email }) => {
    if (await ctx.db.get("reports", email.reportId)) await ctx.db.insert("reportEmails", { ...email, text: text.slice(0, TEXT_KEPT), at: Date.now() });
    return null;
  },
});
