// Activating a report (#1261): what makes its DOI live. Only an admin of the report's workspace activates, and only
// with a card saved on the workspace's billing account. The workspace's free activations for the day cost nothing;
// past them each one buys the "Report activation" plan in Autumn (lib/billing/plans.ts ACTIVATION_PLAN), at the
// plan's price, less what a promotion code takes off. A charge the bank asks to confirm waits as `pending` and goes
// live once Autumn reports its invoice paid (`settle`), so a report is never charged for twice.
import { v, type Infer } from "convex/values";
import { action, internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "../lib/functions";
import { refuseApps } from "../lib/auth";
import { requireAppUrl } from "../lib/env";
import { createError } from "../lib/errors";
import { workspaceQuery } from "../lib/userActions";
import { actorValidator, type Actor } from "../workspaces/actor";
import { customerOf, readAccount, refreshAccount } from "../billing/accounts";
import { AutumnError, autumn, type AutumnCharge } from "../billing/autumn";
import { readCatalog } from "../billing/catalog";
import { purchasing, unlessDeclined } from "../billing/purchases";
import { ACTIVATION_PLAN } from "../../lib/billing/plans";
import { stageOf } from "../../lib/reports/report";
import { canRegister } from "../../lib/reports/settings";
import { MOVED_ON, byKey, changing, touch } from "./flow";
import { freeLeft } from "./limits";
import { notify } from "./mail";
import { register } from "./registering";
import { reportSettings } from "./settings";

/** The longest promotion code taken: Stripe's are at most 500 characters, people's a few words. */
const CODE_MAX = 100;

/** Where a workspace's report is on Publish: an organisation's pages are under its slug. */
async function placeOf(ctx: QueryCtx, workspaceId: Id<"workspaces">) {
  const workspace = await ctx.db.get("workspaces", workspaceId);
  const organization = workspace?.kind === "organization" ? await ctx.db.get("organizations", workspace.organizationId) : null;
  return { organization: organization?.name ?? null, prefix: organization ? `/o/${organization.slug}` : "" };
}

const pendingOf = (ctx: QueryCtx, reportId: Id<"reports">) =>
  ctx.db.query("reportActivations").withIndex("by_reportId", (q) => q.eq("reportId", reportId)).filter((q) => q.eq(q.field("state"), "pending")).first();

/**
 * A report the actor may activate now: theirs to change, in a workspace they are an admin of, ready, and with
 * somewhere to register its DOI. Refuses with what's in the way.
 */
async function activatable(ctx: QueryCtx, actor: Actor, key: string) {
  const report = await changing(ctx, actor, key);
  if (actor.role !== "admin") {
    const { organization } = await placeOf(ctx, actor.workspaceId);
    throw createError("FORBIDDEN", `Only an admin of ${organization ?? "this workspace"} can activate it.`);
  }
  const settings = await reportSettings(ctx);
  const stage = stageOf(report, settings.humanReview);
  if (stage === "live") throw createError("CONFLICT", "This report is already live.");
  if (stage === "review") throw createError("CONFLICT", "A reviewer has to approve this report before you can activate it.");
  if (stage !== "ready") throw createError("CONFLICT", MOVED_ON);
  // A DOI needs somewhere to register: with both registrars switched off, nothing goes live.
  if (!canRegister(settings.publication)) throw createError("FEATURE_DISABLED", "Publishing is paused for now, so nothing can go live. Your report keeps its place.");
  return report;
}

const cardValidator = v.object({ brand: v.string(), last4: v.string() });

/**
 * What activating the report takes, for the page that offers it: whether the person may (an admin of its workspace),
 * the workspace's saved card, its free activations left today, and the price past them. `now` is the page's clock,
 * which the free activations are counted from.
 */
export const terms = workspaceQuery({
  args: { key: v.string(), now: v.number() },
  returns: v.union(
    v.object({
      admin: v.boolean(),
      /** The organisation the report is in; null for a person's own workspace. */
      organization: v.union(v.string(), v.null()),
      card: v.union(cardValidator, v.null()),
      free: v.object({ perDay: v.number(), left: v.number() }),
      /** The activation plan's price in US dollars; null while Autumn's catalog has no such plan. */
      price: v.union(v.number(), v.null()),
      /** A charge the bank asked to confirm, and its page. */
      pending: v.union(v.object({ url: v.union(v.string(), v.null()) }), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, actor, { key, now }) => {
    await refuseApps(ctx);
    const report = await byKey(ctx, key);
    if (!report || report.workspaceId !== actor.workspaceId) return null;
    const plan = (await readCatalog(ctx))?.plans.find((candidate) => candidate.id === ACTIVATION_PLAN);
    const pending = await pendingOf(ctx, report._id);
    return {
      admin: actor.role === "admin",
      organization: (await placeOf(ctx, actor.workspaceId)).organization,
      card: (await readAccount(ctx, actor.workspaceId))?.card ?? null,
      free: await freeLeft(ctx, actor.workspaceId, now),
      price: plan?.price?.amount ?? null,
      pending: pending ? { url: pending.payUrl ?? null } : null,
    };
  },
});

const preparedValidator = v.object({
  reportId: v.id("reports"),
  /** The workspace's customer in Autumn: a person's own workspace is billed as the person. */
  customerId: v.string(),
  freeLeft: v.number(),
  prefix: v.string(),
  pending: v.union(v.object({ url: v.union(v.string(), v.null()) }), v.null()),
});
type Prepared = Infer<typeof preparedValidator>;

/** Everything an activation needs to know before it charges, checked as the actor. */
export const prepare = internalQuery({
  args: { actor: actorValidator, key: v.string(), now: v.number() },
  returns: preparedValidator,
  handler: async (ctx, { actor, key, now }) => {
    const report = await activatable(ctx, actor, key);
    const pending = await pendingOf(ctx, report._id);
    return {
      reportId: report._id,
      customerId: await customerOf(ctx, actor.workspaceId),
      freeLeft: (await freeLeft(ctx, actor.workspaceId, now)).left,
      prefix: (await placeOf(ctx, actor.workspaceId)).prefix,
      pending: pending ? { url: pending.payUrl ?? null } : null,
    };
  },
});

const chargeValidator = v.object({ invoice: v.string(), total: v.number(), currency: v.string(), code: v.optional(v.string()) });

/** Puts the report live and registers its DOI, as its first activation. */
async function putLive(ctx: MutationCtx, report: Doc<"reports">) {
  await touch(ctx, report, { status: "live", activatedAt: Date.now() });
  await register(ctx, report);
  await notify(ctx, report._id, "live");
  await notify(ctx, report._id, "live-author");
}

/**
 * Makes the report live: free, counted against the workspace's free activations for the day, or paid for with
 * `charge`. A free one refuses when the day's free activations went to another report meanwhile. A paid one whose
 * report moved on while it was charged (declined, say) is kept as `unused`, and logged for a refund.
 */
export const goLive = internalMutation({
  args: { actor: actorValidator, key: v.string(), free: v.boolean(), charge: v.optional(chargeValidator) },
  returns: v.null(),
  handler: async (ctx, { actor, key, free, charge }) => {
    const now = Date.now();
    const report = await activatable(ctx, actor, key).catch(async (error: unknown) => {
      if (!charge) throw error;
      const moved = await byKey(ctx, key);
      console.error(JSON.stringify({ event: "report-activation-unused", key, invoice: charge.invoice, total: charge.total, error: String(error).slice(0, 300) }));
      if (moved) await ctx.db.insert("reportActivations", { workspaceId: actor.workspaceId, reportId: moved._id, at: now, by: actor.userId, free: false, state: "unused", charge });
      return null;
    });
    if (!report) return null;
    if (free && (await freeLeft(ctx, actor.workspaceId, now)).left === 0) throw createError("CONFLICT", "Today's free activations were just used. Activate it again to pay for it.");
    const pending = await pendingOf(ctx, report._id);
    if (pending) await ctx.db.patch("reportActivations", pending._id, { state: "live", charge, payUrl: undefined });
    else await ctx.db.insert("reportActivations", { workspaceId: actor.workspaceId, reportId: report._id, at: now, by: actor.userId, free, state: "live", ...(charge && { charge }) });
    await putLive(ctx, report);
    return null;
  },
});

/** Keeps a charge the bank asked to confirm: the report goes live once its invoice is paid. */
export const hold = internalMutation({
  args: { actor: actorValidator, reportId: v.id("reports"), invoice: v.string(), url: v.union(v.string(), v.null()), code: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { actor, reportId, invoice, url, code }) => {
    if (await pendingOf(ctx, reportId)) return null;
    await ctx.db.insert("reportActivations", { workspaceId: actor.workspaceId, reportId, at: Date.now(), by: actor.userId, free: false, state: "pending", charge: { invoice, total: 0, currency: "usd", ...(code && { code }) }, ...(url && { payUrl: url }) });
    return null;
  },
});

/** A promotion code as typed: trimmed, and refused when it can't be one. */
function codeOf(code: string | undefined) {
  const typed = code?.trim();
  if (!typed) return undefined;
  if (typed.length > CODE_MAX) throw createError("VALIDATION_ERROR", "That code is too long to be one of ours.");
  return typed;
}

/** Autumn's refusal of a promotion code, as the person is told it. */
function refusedCode<T>(code: string | undefined) {
  return (error: unknown): T => {
    if (code && error instanceof AutumnError && error.status === 400 && /promotion code/i.test(JSON.stringify(error.body))) {
      throw createError("VALIDATION_ERROR", `${code} isn't a code we know, or it has been used up.`);
    }
    throw error;
  };
}

/** Where Stripe's pages come back to: the report on Publish. A new address each time, so Autumn never reuses an old Checkout. */
const backTo = (prefix: string, key: string) => `${requireAppUrl()}${prefix}/publish?report=${encodeURIComponent(key)}&back=${crypto.randomUUID()}`;

const actorIn = (ctx: ActionCtx, workspaceId: Id<"workspaces">): Promise<Actor> => ctx.runQuery(internal.workspaces.actor.signedInActor, { workspaceId });

/**
 * Activates the report. Free while the workspace has free activations left today; otherwise the activation plan is
 * charged to the saved card, less `code`. Answers `live`, or Stripe's page when the bank asks to confirm the charge,
 * after which the report goes live by itself.
 */
export const activate = action({
  args: { workspaceId: v.id("workspaces"), key: v.string(), code: v.optional(v.string()) },
  returns: v.union(v.object({ live: v.literal(true) }), v.object({ url: v.string() })),
  handler: async (ctx, { workspaceId, key, code: typed }): Promise<{ live: true } | { url: string }> => {
    await refuseApps(ctx);
    const actor = await actorIn(ctx, workspaceId);
    const code = codeOf(typed);
    const first: Prepared = await ctx.runQuery(internal.reports.activation.prepare, { actor, key, now: Date.now() });
    if (first.pending) {
      if (first.pending.url) return { url: first.pending.url };
      throw createError("CONFLICT", "Its payment is still going through. It goes live once it's paid.");
    }
    // The card is read from Autumn, not the cached account: it may have been removed since.
    const customer = await autumn.customer(first.customerId, { card: true });
    if (!customer.payment_method?.card) throw createError("BILLING_CARD_REQUIRED", "Add a payment method to activate.");
    if (first.freeLeft > 0) {
      await ctx.runMutation(internal.reports.activation.goLive, { actor, key, free: true });
      return { live: true };
    }
    const charged: AutumnCharge & { reportId: Id<"reports">; prefix: string } = await purchasing(ctx, workspaceId, first.customerId, {}, async () => {
      // Checked again under the workspace's purchase lock: another tab may have activated it meanwhile.
      const now: Prepared = await ctx.runQuery(internal.reports.activation.prepare, { actor, key, now: Date.now() });
      if (now.pending) throw createError("CONFLICT", "Its payment is still going through. It goes live once it's paid.");
      const result = unlessDeclined(await autumn.attach({ customerId: now.customerId, planId: ACTIVATION_PLAN, code, successUrl: backTo(now.prefix, key) }).catch(refusedCode<AutumnCharge>(code)));
      return { ...result, reportId: now.reportId, prefix: now.prefix };
    });
    const invoice = charged.invoice;
    if (charged.payment_url || (invoice && invoice.status !== "paid")) {
      console.log(JSON.stringify({ event: "report-activation-pending", key, invoice: invoice?.stripe_id, action: charged.required_action?.code }));
      await ctx.runMutation(internal.reports.activation.hold, { actor, reportId: charged.reportId, invoice: invoice?.stripe_id ?? "", url: charged.payment_url ?? invoice?.hosted_invoice_url ?? null, ...(code && { code }) });
      if (charged.payment_url) return { url: charged.payment_url };
      throw createError("CONFLICT", "Its payment is still going through. It goes live once it's paid.");
    }
    await ctx.runMutation(internal.reports.activation.goLive, {
      actor,
      key,
      free: false,
      charge: { invoice: invoice?.stripe_id ?? "none", total: invoice?.total ?? 0, currency: invoice?.currency ?? "usd", ...(code && { code }) },
    });
    return { live: true };
  },
});

/** What activating the report costs with `code`, as Autumn quotes it, in US dollars: the price, the discount and the total. */
export const quote = action({
  args: { workspaceId: v.id("workspaces"), key: v.string(), code: v.string() },
  returns: v.object({ price: v.number(), discount: v.number(), total: v.number() }),
  handler: async (ctx, { workspaceId, key, code: typed }): Promise<{ price: number; discount: number; total: number }> => {
    await refuseApps(ctx);
    const actor = await actorIn(ctx, workspaceId);
    const code = codeOf(typed);
    if (!code) throw createError("VALIDATION_ERROR", "Type a code first.");
    const { customerId }: { customerId: string } = await ctx.runQuery(internal.reports.activation.prepare, { actor, key, now: Date.now() });
    const [plain, discounted] = await Promise.all([autumn.previewAttach(customerId, ACTIVATION_PLAN, false), autumn.previewAttach(customerId, ACTIVATION_PLAN, false, undefined, code).catch(refusedCode<never>(code))]);
    if (discounted.total >= plain.total) throw createError("VALIDATION_ERROR", `${code} doesn't take anything off an activation.`);
    return { price: plain.total, discount: plain.total - discounted.total, total: discounted.total };
  },
});

/** Stripe's page for saving a card on the workspace's billing account, which comes back to the report. Its admins only. */
export const addCard = action({
  args: { workspaceId: v.id("workspaces"), key: v.string() },
  returns: v.string(),
  handler: async (ctx, { workspaceId, key }): Promise<string> => {
    await refuseApps(ctx);
    const actor = await actorIn(ctx, workspaceId);
    const { prefix, customerId }: { prefix: string; customerId: string } = await ctx.runQuery(internal.reports.activation.prepare, { actor, key, now: Date.now() });
    return (await autumn.setupPayment(customerId, backTo(prefix, key))).url;
  },
});

/** The workspace's charges waiting on the bank, with who started each. */
export const waiting = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(v.object({ key: v.string(), invoice: v.string(), by: v.id("users") })),
  handler: async (ctx, { workspaceId }) => {
    // A workspace has one at most: a new purchase waits until an open payment is paid (billing/purchases.ts).
    const rows = await ctx.db.query("reportActivations").withIndex("by_workspaceId_and_state", (q) => q.eq("workspaceId", workspaceId).eq("state", "pending")).take(5);
    const found = await Promise.all(rows.map(async (row) => ({ row, report: await ctx.db.get("reports", row.reportId) })));
    return found.flatMap(({ row, report }) => (report ? [{ key: report.key, invoice: row.charge?.invoice ?? "", by: row.by }] : []));
  },
});

/** Drops a charge the bank never confirmed: its invoice was voided or is gone. The report stays ready. */
export const release = internalMutation({
  args: { workspaceId: v.id("workspaces"), invoice: v.string() },
  returns: v.null(),
  handler: async (ctx, { workspaceId, invoice }) => {
    const rows = await ctx.db.query("reportActivations").withIndex("by_workspaceId_and_state", (q) => q.eq("workspaceId", workspaceId).eq("state", "pending")).take(5);
    for (const row of rows) if (row.charge?.invoice === invoice) await ctx.db.delete("reportActivations", row._id);
    return null;
  },
});

/**
 * Puts live each report of the workspace whose charge the bank confirmed, once Autumn reports its invoice paid.
 * Autumn's and Stripe's webhooks call it, and so does the report's page when Stripe sends the person back.
 */
export async function settlePending(ctx: ActionCtx, workspaceId: Id<"workspaces">) {
  const waits: Array<{ key: string; invoice: string; by: Id<"users"> }> = await ctx.runQuery(internal.reports.activation.waiting, { workspaceId });
  if (waits.length === 0) return;
  const customerId: string = await ctx.runQuery(internal.billing.accounts.customerFor, { workspaceId });
  const invoices = (await autumn.customer(customerId, { invoices: true })).invoices ?? [];
  for (const wait of waits) {
    const invoice = invoices.find((candidate) => candidate.stripe_id === wait.invoice);
    if (invoice?.status === "paid") {
      // The admin who was charged: it goes live as they asked, even if they have stopped being an admin since.
      const actor: Actor = await ctx.runQuery(internal.workspaces.actor.activeActor, { userId: wait.by, workspaceId });
      await ctx.runMutation(internal.reports.activation.goLive, { actor: { ...actor, role: "admin" }, key: wait.key, free: false, charge: { invoice: wait.invoice, total: invoice.total, currency: invoice.currency } });
    } else if (!invoice || invoice.status === "void" || invoice.status === "uncollectible") {
      await ctx.runMutation(internal.reports.activation.release, { workspaceId, invoice: wait.invoice });
    }
  }
}

/**
 * What the report's page does when Stripe sends the person back: the workspace's card is read again, whether a card was
 * just saved or a charge confirmed, and an activation the bank confirmed goes live.
 */
export const settle = action({
  args: { workspaceId: v.id("workspaces") },
  returns: v.null(),
  handler: async (ctx, { workspaceId }): Promise<null> => {
    await refuseApps(ctx);
    await actorIn(ctx, workspaceId);
    await refreshAccount(ctx, workspaceId, { card: true });
    await settlePending(ctx, workspaceId);
    return null;
  },
});

/** `settlePending` for a webhook: Autumn's or Stripe's word that the workspace's billing changed. */
export const settleFor = internalAction({
  args: { workspaceId: v.id("workspaces") },
  returns: v.null(),
  handler: async (ctx, { workspaceId }): Promise<null> => {
    await settlePending(ctx, workspaceId);
    return null;
  },
});
