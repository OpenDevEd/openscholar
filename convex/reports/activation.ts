// Activating a report (#1261): what makes its DOI live. Only an admin of the report's workspace activates, and only
// with a card saved on the workspace's billing account. The workspace's free activations for the day cost nothing;
// past them each one buys the "Report activation" plan in Autumn (lib/billing/plans.ts ACTIVATION_PLAN), at the
// plan's price, less what a promotion code takes off. A charge the bank asks to confirm waits as `pending` and goes
// live once Autumn reports its invoice paid (`settle`), so a report is never charged for twice.
import { ConvexError, v, type Infer } from "convex/values";
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
import { AutumnError, autumn, type AutumnCharge, type AutumnCustomer, type AutumnPreview } from "../billing/autumn";
import { readCatalog } from "../billing/catalog";
import { purchasing, unlessDeclined, voidDeclined } from "../billing/purchases";
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

/** The report's activation that waits on the bank, or with `charging` too, one whose charge is under way. */
const pendingOf = (ctx: QueryCtx, reportId: Id<"reports">, charging = false) =>
  ctx.db
    .query("reportActivations")
    .withIndex("by_reportId", (q) => q.eq("reportId", reportId))
    .filter((q) => (charging ? q.or(q.eq(q.field("state"), "pending"), q.eq(q.field("state"), "charging")) : q.eq(q.field("state"), "pending")))
    .first();

/** Refuses a report that can't go live now, whoever asks: one not ready, or with nowhere to register its DOI. */
async function readyToGoLive(ctx: QueryCtx, report: Doc<"reports">) {
  const settings = await reportSettings(ctx);
  const stage = stageOf(report, settings.humanReview);
  if (stage === "live") throw createError("CONFLICT", "This report is already live.");
  if (stage === "review") throw createError("CONFLICT", "A reviewer has to approve this report before you can activate it.");
  if (stage !== "ready") throw createError("CONFLICT", MOVED_ON);
  // A DOI needs somewhere to register: with both registrars switched off, nothing goes live.
  if (!canRegister(settings.publication)) throw createError("FEATURE_DISABLED", "Publishing is paused for now, so nothing can go live. Your report keeps its place.");
}

/** A report the actor may activate now: theirs to change, in a workspace they are an admin of, and ready to go live. */
async function activatable(ctx: QueryCtx, actor: Actor, key: string) {
  const report = await changing(ctx, actor, key);
  if (actor.role !== "admin") {
    const { organization } = await placeOf(ctx, actor.workspaceId);
    throw createError("FORBIDDEN", `Only an admin of ${organization ?? "this workspace"} can activate it.`);
  }
  await readyToGoLive(ctx, report);
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
      // The bank's page is the payer's: an organisation's members see that it waits, not where to pay (billing/accounts.ts `mine`).
      pending: pending ? { url: actor.role === "admin" ? (pending.payUrl ?? null) : null } : null,
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
  /** A charge was asked for and its answer lost: asking again replays the same request. */
  charging: v.boolean(),
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
      charging: (await pendingOf(ctx, report._id, true))?.state === "charging",
    };
  },
});

const chargeValidator = v.object({ invoice: v.string(), total: v.number(), currency: v.string() });

/** Puts the report live and registers its DOI, as its first activation. */
async function putLive(ctx: MutationCtx, report: Doc<"reports">) {
  await touch(ctx, report, { status: "live", activatedAt: Date.now() });
  await register(ctx, report);
  await notify(ctx, report._id, "live");
  await notify(ctx, report._id, "live-author");
}

const STILL_PAYING = "Its payment is still going through. It goes live once it's paid.";

/** Makes the report live as one of the workspace's free activations for the day, refused once they are used. */
export const goLiveFree = internalMutation({
  args: { actor: actorValidator, key: v.string() },
  returns: v.null(),
  handler: async (ctx, { actor, key }) => {
    const report = await activatable(ctx, actor, key);
    if (await pendingOf(ctx, report._id, true)) throw createError("CONFLICT", STILL_PAYING);
    if ((await freeLeft(ctx, actor.workspaceId, Date.now())).left === 0) throw createError("CONFLICT", "Today's free activations were just used. Activate it again to pay for it.");
    await ctx.db.insert("reportActivations", { workspaceId: actor.workspaceId, reportId: report._id, at: Date.now(), by: actor.userId, free: true, state: "live" });
    await putLive(ctx, report);
    return null;
  },
});

/**
 * Starts a paid activation before anything is charged: its record, whose id is the charge's idempotency key at
 * Autumn, with the code it is asked with. A record still `charging` (its answer was lost) is the one carried on, with
 * its own code, so asking again can't charge twice. Refuses while a charge waits on the bank.
 */
export const begin = internalMutation({
  args: { actor: actorValidator, key: v.string(), code: v.optional(v.string()) },
  returns: v.object({ activationId: v.id("reportActivations"), code: v.optional(v.string()) }),
  handler: async (ctx, { actor, key, code }) => {
    const report = await activatable(ctx, actor, key);
    const under = await pendingOf(ctx, report._id, true);
    if (under?.state === "pending") throw createError("CONFLICT", STILL_PAYING);
    if (under) return { activationId: under._id, ...(under.code && { code: under.code }) };
    const activationId = await ctx.db.insert("reportActivations", { workspaceId: actor.workspaceId, reportId: report._id, at: Date.now(), by: actor.userId, free: false, state: "charging", ...(code && { code }) });
    return { activationId, ...(code && { code }) };
  },
});

const outcomeValidator = v.union(
  v.object({ kind: v.literal("paid"), charge: chargeValidator }),
  v.object({ kind: v.literal("pending"), invoice: v.string(), url: v.union(v.string(), v.null()) }),
  v.object({ kind: v.literal("none") }),
);

/**
 * Records what an activation's charge came to. Paid: the report goes live, as its admin asked when it was charged,
 * or the record is kept `unused` and logged for a refund when the report moved on meanwhile. Waiting on the bank:
 * `pending`, with the bank's page. Nothing charged (declined, a refused code, a voided invoice): the record goes.
 * A record already settled is left as it is, so the webhooks and the page settling the same charge change nothing.
 */
export const settleCharge = internalMutation({
  args: { activationId: v.id("reportActivations"), outcome: outcomeValidator },
  returns: v.null(),
  handler: async (ctx, { activationId, outcome }) => {
    const activation = await ctx.db.get("reportActivations", activationId);
    if (!activation || activation.state === "live" || activation.state === "unused") return null;
    if (outcome.kind === "none") {
      await ctx.db.delete("reportActivations", activationId);
      return null;
    }
    if (outcome.kind === "pending") {
      await ctx.db.patch("reportActivations", activationId, { state: "pending", charge: { invoice: outcome.invoice, total: 0, currency: "usd" }, payUrl: outcome.url ?? undefined });
      // The bank's page has no way back here and the webhooks can be late: the charge is looked at until it's settled.
      await ctx.scheduler.runAfter(WATCH_FIRST_MS, internal.reports.activation.watch, { activationId, attempt: 0 });
      return null;
    }
    const report = await ctx.db.get("reports", activation.reportId);
    const refused = report ? await readyToGoLive(ctx, report).then(() => null, (error: unknown) => String(error)) : "The report is gone.";
    if (!report || refused) {
      console.error(JSON.stringify({ event: "report-activation-unused", activationId, invoice: outcome.charge.invoice, total: outcome.charge.total, error: refused?.slice(0, 300) }));
      await ctx.db.patch("reportActivations", activationId, { state: "unused", charge: outcome.charge, payUrl: undefined });
      return null;
    }
    await ctx.db.patch("reportActivations", activationId, { state: "live", charge: outcome.charge, payUrl: undefined });
    await putLive(ctx, report);
    return null;
  },
});

/** What Autumn answered to a charge, as `settleCharge` records it. */
function outcomeOf(charged: AutumnCharge): Infer<typeof outcomeValidator> {
  const invoice = charged.invoice;
  if (charged.payment_url || (invoice && invoice.status !== "paid")) return { kind: "pending", invoice: invoice?.stripe_id ?? "", url: charged.payment_url ?? invoice?.hosted_invoice_url ?? null };
  // Nothing to pay (a 100% code) has no invoice that was paid, and is paid all the same.
  return { kind: "paid", charge: { invoice: invoice?.stripe_id ?? "none", total: invoice?.total ?? 0, currency: invoice?.currency ?? "usd" } };
}

/** An error that means Autumn charged nothing: a decline, a refused code, a refused request. Anything else may have charged. */
const chargedNothing = (error: unknown) => error instanceof ConvexError || (error instanceof AutumnError && error.status >= 400 && error.status < 500);

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

/**
 * Where Stripe's pages come back to: the report on Publish. `mark` makes the address new for each card saved, so Autumn
 * never reuses an old Checkout, and the same for each charge, so a charge asked again is the same request.
 */
const backTo = (prefix: string, key: string, mark: string = crypto.randomUUID()) => `${requireAppUrl()}${prefix}/publish?report=${encodeURIComponent(key)}&back=${mark}`;

const actorIn = (ctx: ActionCtx, workspaceId: Id<"workspaces">): Promise<Actor> => ctx.runQuery(internal.workspaces.actor.signedInActor, { workspaceId });

/**
 * Activates the report. `pay` says the person confirmed paying for it: without it, it goes live only as one of the
 * workspace's free activations, and is refused once they are used, never charged. With it, a free activation left is
 * still used first; otherwise the activation plan is charged to the saved card, less `code`. Answers `live`, or the
 * bank's page when it asks to confirm the charge, after which the report goes live by itself.
 */
export const activate = action({
  args: { workspaceId: v.id("workspaces"), key: v.string(), pay: v.boolean(), code: v.optional(v.string()) },
  returns: v.union(v.object({ live: v.literal(true) }), v.object({ url: v.string() })),
  handler: async (ctx, { workspaceId, key, pay, code: typed }): Promise<{ live: true } | { url: string }> => {
    await refuseApps(ctx);
    const actor = await actorIn(ctx, workspaceId);
    const code = codeOf(typed);
    const first: Prepared = await ctx.runQuery(internal.reports.activation.prepare, { actor, key, now: Date.now() });
    if (first.pending) {
      if (first.pending.url) return { url: first.pending.url };
      throw createError("CONFLICT", STILL_PAYING);
    }
    // The card is read from Autumn, not the cached account: it may have been removed since.
    const customer = await autumn.customer(first.customerId, { card: true });
    if (!customer.payment_method?.card) throw createError("BILLING_CARD_REQUIRED", "Add a payment method to activate.");
    if (first.freeLeft > 0 && !first.charging) {
      await ctx.runMutation(internal.reports.activation.goLiveFree, { actor, key });
      return { live: true };
    }
    if (!pay) throw createError("CONFLICT", "Today's free activations were just used. Activate it again to pay for it.");
    // Under the workspace's purchase lock from the record to the answer, so another tab's activation waits for this one.
    const outcome = await purchasing(ctx, workspaceId, first.customerId, first.charging ? { resuming: true } : {}, async () => {
      const started: { activationId: Id<"reportActivations">; code?: string } = await ctx.runMutation(internal.reports.activation.begin, { actor, key, ...(code && { code }) });
      const asked = started.code;
      let charged: AutumnCharge;
      try {
        charged = await autumn.attach({ customerId: first.customerId, planId: ACTIVATION_PLAN, code: asked, idempotencyKey: `report-activation-${started.activationId}`, successUrl: backTo(first.prefix, key, started.activationId) }).catch(refusedCode<AutumnCharge>(asked));
        // Declined, its invoice is voided so the decline changes nothing: the next try, with another card or a code, isn't
        // held up by a $5 invoice left open.
        if (charged.required_action?.code === "payment_failed" && charged.invoice?.stripe_id) await voidDeclined(charged.invoice.stripe_id);
        unlessDeclined(charged);
      } catch (error) {
        // Charged nothing: the record goes, and the next try starts afresh. Otherwise it stays `charging`, and the next
        // try asks Autumn the same request again, which answers what this one did.
        if (chargedNothing(error)) await ctx.runMutation(internal.reports.activation.settleCharge, { activationId: started.activationId, outcome: { kind: "none" } });
        throw error;
      }
      const done = outcomeOf(charged);
      if (done.kind === "pending") console.log(JSON.stringify({ event: "report-activation-pending", key, invoice: done.invoice, action: charged.required_action?.code }));
      await ctx.runMutation(internal.reports.activation.settleCharge, { activationId: started.activationId, outcome: done });
      return done;
    });
    if (outcome.kind === "pending") {
      if (outcome.url) return { url: outcome.url };
      throw createError("CONFLICT", STILL_PAYING);
    }
    return { live: true };
  },
});

/** What a quote's lines come to, in US dollars, before any credit on the account. */
const linesOf = (preview: AutumnPreview) => preview.line_items.reduce((sum, line) => sum + line.total, 0);

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
    // Read from the quote's lines: its total is what's due after any credit on the account, which a code doesn't change.
    const price = linesOf(plain);
    const total = linesOf(discounted);
    if (total >= price) throw createError("VALIDATION_ERROR", `${code} doesn't take anything off an activation.`);
    return { price, discount: price - total, total };
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

/** How soon a charge waiting on the bank is first looked at, how far apart the looks grow, and how many there are: about two days. */
const WATCH_FIRST_MS = 20_000;
const WATCH_MOST_MS = 60 * 60_000;
const WATCH_LOOKS = 60;

/** A charge waiting on the bank, by its record: its workspace and invoice, or null once it's settled. */
export const waitingCharge = internalQuery({
  args: { activationId: v.id("reportActivations") },
  returns: v.union(v.object({ workspaceId: v.id("workspaces"), invoice: v.string() }), v.null()),
  handler: async (ctx, { activationId }) => {
    const activation = await ctx.db.get("reportActivations", activationId);
    return activation?.state === "pending" ? { workspaceId: activation.workspaceId, invoice: activation.charge?.invoice ?? "" } : null;
  },
});

/** Settles one waiting charge from Autumn's invoices: live once paid, dropped once voided. Answers whether it's settled. */
async function settleOne(ctx: ActionCtx, activationId: Id<"reportActivations">, invoice: string, invoices: AutumnCustomer["invoices"] = []) {
  const found = invoices.find((candidate) => candidate.stripe_id === invoice);
  if (found?.status === "paid") {
    await ctx.runMutation(internal.reports.activation.settleCharge, { activationId, outcome: { kind: "paid", charge: { invoice, total: found.total, currency: found.currency } } });
    return true;
  }
  if (found?.status === "void" || found?.status === "uncollectible") {
    await ctx.runMutation(internal.reports.activation.settleCharge, { activationId, outcome: { kind: "none" } });
    return true;
  }
  return false;
}

/** Looks at a charge waiting on the bank, and again later, further apart each time, until it's settled or about two days have gone. */
export const watch = internalAction({
  args: { activationId: v.id("reportActivations"), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, { activationId, attempt }): Promise<null> => {
    const waiting: { workspaceId: Id<"workspaces">; invoice: string } | null = await ctx.runQuery(internal.reports.activation.waitingCharge, { activationId });
    if (!waiting) return null;
    try {
      const customerId: string = await ctx.runQuery(internal.billing.accounts.customerFor, { workspaceId: waiting.workspaceId });
      if (await settleOne(ctx, activationId, waiting.invoice, (await autumn.customer(customerId, { invoices: true })).invoices)) return null;
    } catch (error) {
      // A look that failed (Autumn slow or down) is the next look's to make.
      console.error(JSON.stringify({ event: "report-activation-watch-failed", activationId, attempt, error: String(error).slice(0, 300) }));
    }
    if (attempt + 1 < WATCH_LOOKS) await ctx.scheduler.runAfter(Math.min(WATCH_FIRST_MS * 2 ** (attempt + 1), WATCH_MOST_MS), internal.reports.activation.watch, { activationId, attempt: attempt + 1 });
    else console.error(JSON.stringify({ event: "report-activation-unsettled", activationId, invoice: waiting.invoice }));
    return null;
  },
});

/** The workspace's charges waiting on the bank, by their invoice. */
export const waiting = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(v.object({ activationId: v.id("reportActivations"), invoice: v.string() })),
  handler: async (ctx, { workspaceId }) => {
    // A workspace has one at most: a new purchase waits until an open payment is paid (billing/purchases.ts).
    const rows = await ctx.db.query("reportActivations").withIndex("by_workspaceId_and_state", (q) => q.eq("workspaceId", workspaceId).eq("state", "pending")).take(5);
    return rows.map((row) => ({ activationId: row._id, invoice: row.charge?.invoice ?? "" }));
  },
});

/**
 * Settles each charge of the workspace that waited on the bank: live once Autumn reports its invoice paid, dropped
 * once it's voided. Autumn's and Stripe's webhooks call it, and so does the report's page when Stripe sends the person
 * back; settling one twice changes nothing.
 */
export async function settlePending(ctx: ActionCtx, workspaceId: Id<"workspaces">) {
  const waits: Array<{ activationId: Id<"reportActivations">; invoice: string }> = await ctx.runQuery(internal.reports.activation.waiting, { workspaceId });
  if (waits.length === 0) return;
  const customerId: string = await ctx.runQuery(internal.billing.accounts.customerFor, { workspaceId });
  const invoices = (await autumn.customer(customerId, { invoices: true })).invoices ?? [];
  for (const wait of waits) await settleOne(ctx, wait.activationId, wait.invoice, invoices);
}

/**
 * What a report's page does as it opens: a charge of the workspace's that waited on the bank and has been paid since
 * goes live, wherever the person paid it (Stripe's invoice page has no way back here). With `card`, when Stripe sent the
 * person back after saving one, the workspace's card is read again first. Nothing waiting costs one read.
 */
export const settle = action({
  args: { workspaceId: v.id("workspaces"), card: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { workspaceId, card }): Promise<null> => {
    await refuseApps(ctx);
    await actorIn(ctx, workspaceId);
    if (card) await refreshAccount(ctx, workspaceId, { card: true });
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
