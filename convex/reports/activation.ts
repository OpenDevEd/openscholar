// Activating a report (#1261): what makes its DOI live. Only an admin of the report's workspace activates. Each
// activation spends one from the workspace's balance of activations, which Autumn keeps (lib/billing/plans.ts
// ACTIVATIONS_FEATURE): plans and balances given in Autumn's dashboard fill it, by the day, week, month or year, or
// once. With none left, activating buys one: the "Report activation" plan (ACTIVATION_PLAN) at its price, less what a
// promotion code takes off, which adds one to the balance, spent on the spot. A charge the bank asks to confirm waits
// as `pending`: the bank's page comes back to the report, which goes live once Stripe has the invoice paid (`settle`).
// An activation bought for a report that can't go live any more stays in the balance for the next one.
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
import { AutumnError, autumn, type AutumnCharge, type AutumnPreview } from "../billing/autumn";
import { readCatalog } from "../billing/catalog";
import { isLockNotFound } from "../billing/charge";
import { holdingPurchaseLock, payableCustomer, unlessDeclined } from "../billing/purchases";
import { bankPage, chargeOf, voidDeclined, voidInvoice } from "../billing/stripeRest";
import { ACTIVATIONS_FEATURE, ACTIVATION_PLAN } from "../../lib/billing/plans";
import { stageOf } from "../../lib/reports/report";
import { canRegister } from "../../lib/reports/settings";
import type { PublicationSettings } from "../evidenceLibraries/publicationValidators";
import { MOVED_ON, byKey, changing, touch } from "./flow";
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

/** The report's activation that waits on the bank. */
const pendingOf = (ctx: QueryCtx, reportId: Id<"reports">) =>
  ctx.db
    .query("reportActivations")
    .withIndex("by_reportId", (q) => q.eq("reportId", reportId))
    .filter((q) => q.eq(q.field("state"), "pending"))
    .first();

/** Refuses a report that can't go live now, whoever asks: one not ready, or with nowhere to register its DOI. */
async function readyToGoLive(ctx: QueryCtx, report: Doc<"reports">) {
  const settings = await reportSettings(ctx);
  const stage = stageOf(report, settings.humanReview);
  if (stage === "live") throw createError("CONFLICT", "This report is already live.");
  if (stage === "review") throw createError("CONFLICT", "A reviewer has to approve this report before you can activate it.");
  if (stage !== "ready") throw createError("CONFLICT", MOVED_ON);
  if (paused(report, settings.publication)) throw createError("FEATURE_DISABLED", PAUSED, { reason: "paused" });
}

const PAUSED = "Publishing is paused for now, so nothing can go live. Your report keeps its place.";

/**
 * Whether the report can't go live for now: its DOI needs the registrar it was reserved with (Crossref's, or Zenodo's
 * when Crossref had none), and the archive needs one switched on at all. Asked before anything is charged.
 */
const paused = (report: Doc<"reports">, publication: PublicationSettings) =>
  !canRegister(publication) || (report.registration.crossref ? publication.crossref.mode === "off" : publication.zenodo.mode === "off");

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
 * the activations left in the workspace's balance, and with none left, the price of one and the workspace's saved card.
 */
export const terms = workspaceQuery({
  args: { key: v.string() },
  returns: v.union(
    v.object({
      admin: v.boolean(),
      /** The organisation the report is in; null for a person's own workspace. */
      organization: v.union(v.string(), v.null()),
      card: v.union(cardValidator, v.null()),
      /** Credit on the workspace's Stripe balance, in US dollars, which a charge is paid from first. */
      credit: v.number(),
      /** Activations left in the workspace's balance, as last read from Autumn; null for no limit. */
      activations: v.union(v.number(), v.null()),
      /** The activation plan's price in US dollars; null while Autumn's catalog has no such plan. */
      price: v.union(v.number(), v.null()),
      /** A charge the bank asked to confirm, and its page. */
      pending: v.union(v.object({ url: v.union(v.string(), v.null()) }), v.null()),
      /**
       * The report's last charge waited on the bank, which didn't confirm it: nothing was charged. With the promotion
       * code it was asked with, which is still the person's to use.
       */
      refused: v.union(v.object({ code: v.union(v.string(), v.null()) }), v.null()),
      /** An activation was bought for the report, which had moved on by then: it went to the balance. */
      kept: v.boolean(),
      /** Publishing is switched off where this report's DOI is registered: it can't go live for now. */
      paused: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, actor, { key }) => {
    await refuseApps(ctx);
    const report = await byKey(ctx, key);
    if (!report || report.workspaceId !== actor.workspaceId) return null;
    const plan = (await readCatalog(ctx))?.plans.find((candidate) => candidate.id === ACTIVATION_PLAN);
    const pending = await pendingOf(ctx, report._id);
    // The last one that came to something: one still under way, or left behind by an action that died, says nothing yet.
    const last = await ctx.db.query("reportActivations").withIndex("by_reportId", (q) => q.eq("reportId", report._id)).order("desc").filter((q) => q.neq(q.field("state"), "charging")).first();
    const account = await readAccount(ctx, actor.workspaceId);
    return {
      admin: actor.role === "admin",
      organization: (await placeOf(ctx, actor.workspaceId)).organization,
      card: account?.card ?? null,
      credit: account?.credit ?? 0,
      activations: account?.activations === null ? null : (account?.activations ?? 0),
      price: plan?.price?.amount ?? null,
      // The bank's page is the payer's: an organisation's members see that it waits, not where to pay (billing/accounts.ts `mine`).
      pending: pending ? { url: actor.role === "admin" ? (pending.payUrl ?? null) : null } : null,
      refused: last?.state === "refused" ? { code: last.code ?? null } : null,
      kept: last?.state === "unused",
      paused: paused(report, (await reportSettings(ctx)).publication),
    };
  },
});

const preparedValidator = v.object({
  /** The workspace's customer in Autumn: a person's own workspace is billed as the person. */
  customerId: v.string(),
  prefix: v.string(),
  pending: v.union(v.object({ url: v.union(v.string(), v.null()) }), v.null()),
  /** Another report of the workspace whose charge waits on the bank, by its key: nothing else activates until it's answered. */
  waitingOn: v.union(v.string(), v.null()),
  /** Who is activating, by their email: an organisation's customer has none until it is given one. */
  email: v.union(v.string(), v.null()),
});
type Prepared = Infer<typeof preparedValidator>;

/** The key of another report of the workspace whose charge waits on the bank, or null. */
async function waitingOther(ctx: QueryCtx, workspaceId: Id<"workspaces">, reportId: Id<"reports">) {
  const waits = await ctx.db.query("reportActivations").withIndex("by_workspaceId_and_state", (q) => q.eq("workspaceId", workspaceId).eq("state", "pending")).take(5);
  const other = waits.find((wait) => wait.reportId !== reportId);
  return other ? ((await ctx.db.get("reports", other.reportId))?.key ?? null) : null;
}

/** Everything an activation needs to know before it starts, checked as the actor. */
export const prepare = internalQuery({
  args: { actor: actorValidator, key: v.string() },
  returns: preparedValidator,
  handler: async (ctx, { actor, key }) => {
    const report = await activatable(ctx, actor, key);
    const pending = await pendingOf(ctx, report._id);
    return {
      customerId: await customerOf(ctx, actor.workspaceId),
      prefix: (await placeOf(ctx, actor.workspaceId)).prefix,
      pending: pending ? { url: pending.payUrl ?? null } : null,
      waitingOn: await waitingOther(ctx, actor.workspaceId, report._id),
      email: (await ctx.db.get("users", actor.userId))?.email ?? null,
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

/** The page offered an activation from the balance that isn't there any more: spent since, or reset. */
const NONE_LEFT = "There's no activation left in the balance. Activate it again to pay for one.";
const STILL_PAYING = "Its payment is still going through. It goes live once it's paid.";
/** Bought, and its report can't go live: the activation is the balance's. */
const KEPT = "This report can't go live now, so the activation you paid for stays in your balance. The next report you activate uses it.";

/**
 * Starts an activation: its record, whose id is the idempotency key of what it buys and names its holds at Autumn,
 * with the code it would be paid with. Refuses while a charge for the report waits on the bank.
 */
export const begin = internalMutation({
  args: { actor: actorValidator, key: v.string(), code: v.optional(v.string()) },
  returns: v.id("reportActivations"),
  handler: async (ctx, { actor, key, code }) => {
    const report = await activatable(ctx, actor, key);
    if (await pendingOf(ctx, report._id)) throw createError("CONFLICT", STILL_PAYING);
    return await ctx.db.insert("reportActivations", { workspaceId: actor.workspaceId, reportId: report._id, at: Date.now(), by: actor.userId, state: "charging", ...(code && { code }) });
  },
});

/** Drops the record of an activation that came to nothing. One that waits on the bank, went live or kept what it bought stays. */
export const forget = internalMutation({
  args: { activationId: v.id("reportActivations") },
  returns: v.null(),
  handler: async (ctx, { activationId }) => {
    if ((await ctx.db.get("reportActivations", activationId))?.state === "charging") await ctx.db.delete("reportActivations", activationId);
    return null;
  },
});

const outcomeValidator = v.union(
  /** One activation of the balance is held for the report, under `hold`: the report goes live. `charge`: what buying it for this report came to. */
  v.object({ kind: v.literal("held"), hold: v.string(), charge: v.optional(chargeValidator) }),
  /** One was bought for the report, and the balance had none to hold: kept, with the report as it was. */
  v.object({ kind: v.literal("bought"), charge: chargeValidator }),
  v.object({ kind: v.literal("pending"), invoice: v.string(), url: v.union(v.string(), v.null()) }),
  v.object({ kind: v.literal("none") }),
  v.object({ kind: v.literal("refused") }),
);

/**
 * Records what became of an activation, and answers whether its report is live by it. Held: the report goes live, as
 * its admin asked. A report that moved on meanwhile is refused, or when the activation was bought for it, the record is
 * kept `unused` and whoever pays is told the activation stays in the balance. Waiting on the bank: `pending`, with the
 * bank's page. Nothing charged (declined, a refused code, a voided invoice): the record goes, or after waiting on the
 * bank, stays `refused`, so the report can say why it isn't live.
 * A record already settled is left as it is, so the webhooks and the page settling the same charge change nothing.
 */
export const settleCharge = internalMutation({
  args: { activationId: v.id("reportActivations"), outcome: outcomeValidator },
  returns: v.boolean(),
  handler: async (ctx, { activationId, outcome }) => {
    const activation = await ctx.db.get("reportActivations", activationId);
    if (!activation || activation.state === "live" || activation.state === "unused") return activation?.state === "live";
    if (outcome.kind === "none" || outcome.kind === "refused") {
      if (outcome.kind === "none") await ctx.db.delete("reportActivations", activationId);
      else await ctx.db.patch("reportActivations", activationId, { state: "refused", payUrl: undefined });
      // A voided invoice gives back any credit it had taken: the page reads it again.
      await ctx.scheduler.runAfter(0, internal.billing.accounts.refresh, { workspaceId: activation.workspaceId, card: true });
      return false;
    }
    if (outcome.kind === "pending") {
      await ctx.db.patch("reportActivations", activationId, { state: "pending", charge: { invoice: outcome.invoice, total: 0, currency: "usd" }, payUrl: outcome.url ?? undefined });
      // The person may leave the bank's page unanswered, or pay it elsewhere, and the webhooks can be late: the charge
      // is looked at until it's settled.
      await ctx.scheduler.runAfter(WATCH_FIRST_MS, internal.reports.activation.watch, { activationId, attempt: 0 });
      return false;
    }
    const report = await ctx.db.get("reports", activation.reportId);
    const stopped: unknown = outcome.kind === "bought" ? "The balance had no activation to hold." : report ? await readyToGoLive(ctx, report).then(() => null, (error: unknown) => error) : createError("NOT_FOUND", MOVED_ON);
    if (report && !stopped && outcome.kind === "held") {
      await ctx.db.patch("reportActivations", activationId, { state: "live", hold: outcome.hold, ...(outcome.charge && { charge: outcome.charge }), payUrl: undefined });
      await putLive(ctx, report);
      return true;
    }
    // Nothing was bought for it: the hold is given back, and the person is told why the report isn't live.
    if (!outcome.charge) throw stopped;
    console.error(JSON.stringify({ event: "report-activation-unused", activationId, held: outcome.kind === "held", invoice: outcome.charge.invoice, total: outcome.charge.total, error: String(stopped).slice(0, 300) }));
    await ctx.db.patch("reportActivations", activationId, { state: "unused", charge: outcome.charge, payUrl: undefined });
    // The one bought is in the balance, which the page reads again. With a hold, that waits until the hold is given back (`finish`).
    if (outcome.kind === "bought") await ctx.scheduler.runAfter(0, internal.billing.accounts.refresh, { workspaceId: activation.workspaceId, card: true });
    const workspace = await ctx.db.get("workspaces", activation.workspaceId);
    await notify(ctx, activation.reportId, workspace?.kind === "organization" ? "kept-admins" : "kept");
    return false;
  },
});

/** How long an activation stays held with nothing finishing it: far longer than a report takes to go live. */
const HOLD_MS = 5 * 60_000;
/** The idempotency key of what a record buys, and the start of its holds' names at Autumn. */
const nameOf = (activationId: Id<"reportActivations">) => `report-activation-${activationId}`;

/** A record's workspace, the hold its report went live by if it did, and whether it is still under way; null once the record is gone. */
export const held = internalQuery({
  args: { activationId: v.id("reportActivations") },
  returns: v.union(v.object({ workspaceId: v.id("workspaces"), hold: v.union(v.string(), v.null()), at: v.number(), charging: v.boolean() }), v.null()),
  handler: async (ctx, { activationId }) => {
    const activation = await ctx.db.get("reportActivations", activationId);
    return activation ? { workspaceId: activation.workspaceId, hold: activation.state === "live" ? (activation.hold ?? null) : null, at: activation.at, charging: activation.state === "charging" } : null;
  },
});

/** How long one settlement of a paid charge has the record to itself: far longer than a spend takes. */
const SETTLE_LEASE_MS = 2 * 60_000;

/**
 * Lets one caller settle a paid charge waiting on the bank: the watch, the webhooks and the page all try, and two
 * spending it at once would see each other's hold and keep it unspent. True for the caller that may go on.
 */
export const claimSettle = internalMutation({
  args: { activationId: v.id("reportActivations") },
  returns: v.boolean(),
  handler: async (ctx, { activationId }) => {
    const activation = await ctx.db.get("reportActivations", activationId);
    if (activation?.state !== "pending" || (activation.settling !== undefined && Date.now() - activation.settling < SETTLE_LEASE_MS)) return false;
    await ctx.db.patch("reportActivations", activationId, { settling: Date.now() });
    return true;
  },
});

/**
 * Finishes one hold at Autumn: its activation is taken when the record's report went live by this very hold, and
 * given back otherwise, so a second hold on a record already settled never takes a second activation. A hold already
 * finished changes nothing. The workspace's balance is read again after.
 */
async function finish(ctx: ActionCtx, activationId: Id<"reportActivations">, hold: string) {
  const record: { workspaceId: Id<"workspaces">; hold: string | null } | null = await ctx.runQuery(internal.reports.activation.held, { activationId });
  try {
    await autumn.finalize(hold, record?.hold === hold ? "confirm" : "release");
  } catch (error) {
    if (!isLockNotFound(error)) throw error;
  }
  if (record) await ctx.scheduler.runAfter(0, internal.billing.accounts.refresh, { workspaceId: record.workspaceId, card: true });
}

/** How many times a hold left standing is finished again, further apart each time, before it's left to a person. */
const FINISH_TRIES = 10;

/**
 * Finishes a hold whose activation never did, because its action died or Autumn couldn't be reached: this Autumn
 * never lets go of a hold by itself. Every hold books one when it is taken, by its own name, so it never touches
 * another try's hold.
 */
export const finishHold = internalAction({
  args: { activationId: v.id("reportActivations"), hold: v.string(), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, { activationId, hold, attempt }): Promise<null> => {
    try {
      await finish(ctx, activationId, hold);
    } catch (error) {
      console.error(JSON.stringify({ event: "report-activation-hold-unfinished", activationId, hold, attempt, error: String(error).slice(0, 300) }));
      if (attempt + 1 < FINISH_TRIES) await ctx.scheduler.runAfter(Math.min(WATCH_FIRST_MS * 2 ** (attempt + 1), WATCH_MOST_MS), internal.reports.activation.finishHold, { activationId, hold, attempt: attempt + 1 });
    }
    return null;
  },
});

/**
 * Spends one activation from the customer's balance on the record's report: held at Autumn under a name of this
 * try's own, the report put live, then taken, or given back when the report couldn't go live or was live already.
 * `charge` is what buying it for this report came to: with one, an activation that can't be held or spent is kept on
 * record all the same. Answers whether the report is live by this record. False with nothing bought means the
 * balance had none.
 */
async function spend(ctx: ActionCtx, customerId: string, activationId: Id<"reportActivations">, charge?: Infer<typeof chargeValidator>): Promise<boolean> {
  const hold = `${nameOf(activationId)}-${crypto.randomUUID()}`;
  const record = (outcome: Infer<typeof outcomeValidator>): Promise<boolean> => ctx.runMutation(internal.reports.activation.settleCharge, { activationId, outcome });
  let holding = false;
  try {
    await ctx.scheduler.runAfter(HOLD_MS, internal.reports.activation.finishHold, { activationId, hold, attempt: 0 });
    holding = (await autumn.lock({ customerId, feature: ACTIVATIONS_FEATURE, credits: 1, lockId: hold, expiresAt: Date.now() + HOLD_MS })).allowed;
    if (!holding && !charge) return false;
    return await record(holding ? { kind: "held", hold, ...(charge && { charge }) } : { kind: "bought", charge: charge! });
  } catch (error) {
    // Nothing bought: the person is told what stopped it. Bought, it is on record as kept whatever went wrong here.
    if (!charge) throw error;
    console.error(JSON.stringify({ event: "report-activation-spend-failed", activationId, hold, error: String(error).slice(0, 300) }));
    return await record({ kind: "bought", charge });
  } finally {
    // A hold Autumn couldn't be told about now is finished by the one booked above.
    if (holding) await finish(ctx, activationId, hold).catch((error: unknown) => console.error(JSON.stringify({ event: "report-activation-hold-unfinished", activationId, hold, error: String(error).slice(0, 300) })));
  }
}

/** What Autumn answered to a charge: paid, or waiting on the bank. */
function outcomeOf(charged: AutumnCharge): { kind: "paid"; charge: Infer<typeof chargeValidator> } | { kind: "pending"; invoice: string; url: string | null } {
  const invoice = charged.invoice;
  if (charged.payment_url || (invoice && invoice.status !== "paid")) return { kind: "pending", invoice: invoice?.stripe_id ?? "", url: charged.payment_url ?? invoice?.hosted_invoice_url ?? null };
  // Nothing to pay (a 100% code) has no invoice that was paid, and is paid all the same.
  return { kind: "paid", charge: { invoice: invoice?.stripe_id ?? "none", total: invoice?.total ?? 0, currency: invoice?.currency ?? "usd" } };
}

/** A promotion code as typed: trimmed, and refused when it can't be one. */
function codeOf(code: string | undefined) {
  const typed = code?.trim();
  if (!typed) return undefined;
  if (typed.length > CODE_MAX) throw createError("VALIDATION_ERROR", "That code is too long to be one of ours.", { reason: "codeTooLong" });
  return typed;
}

/** Autumn's refusal of a promotion code, as the person is told it. */
function refusedCode<T>(code: string | undefined) {
  return (error: unknown): T => {
    if (code && error instanceof AutumnError && error.status === 400 && /promotion code/i.test(JSON.stringify(error.body))) {
      throw createError("VALIDATION_ERROR", `${code} isn't a code we know, or it has been used up.`, { reason: "unknownCode", code });
    }
    throw error;
  };
}

/**
 * Where Stripe's pages come back to: the report on Publish. `mark` makes the address new for each card saved, so Autumn
 * never reuses an old Checkout, and the same for each charge.
 */
const backTo = (prefix: string, key: string, mark: string = crypto.randomUUID()) => `${requireAppUrl()}${prefix}/publish?report=${encodeURIComponent(key)}&back=${mark}`;

const actorIn = (ctx: ActionCtx, workspaceId: Id<"workspaces">): Promise<Actor> => ctx.runQuery(internal.workspaces.actor.signedInActor, { workspaceId });

/**
 * Activates the report. An activation in the workspace's balance is spent first, whatever card or code there is:
 * nothing is charged. With none left, `pay` says the person agreed to buy one: without it the activation is refused,
 * never charged. With it, the activation plan is charged to the saved card, less `code`, or to nothing when the code
 * takes the whole price off, and the activation bought is spent on the report. Answers `live`, or the bank's page when
 * it asks to confirm the charge, after which the report goes live by itself.
 */
export const activate = action({
  args: {
    workspaceId: v.id("workspaces"),
    key: v.string(),
    pay: v.boolean(),
    code: v.optional(v.string()),
    /** What the person was shown as due, in US dollars: a charge that would take more from the card is refused. */
    expect: v.optional(v.number()),
  },
  returns: v.union(v.object({ live: v.literal(true) }), v.object({ url: v.string() })),
  handler: async (ctx, { workspaceId, key, pay, code: typed, expect }): Promise<{ live: true } | { url: string }> => {
    await refuseApps(ctx);
    const actor = await actorIn(ctx, workspaceId);
    const code = codeOf(typed);
    const first: Prepared = await ctx.runQuery(internal.reports.activation.prepare, { actor, key });
    if (first.pending) {
      if (first.pending.url) return { url: first.pending.url };
      throw createError("CONFLICT", STILL_PAYING);
    }
    // What that payment buys lands in the same balance: nothing else is spent from it until that report has its own.
    if (first.waitingOn) throw createError("CONFLICT", `${first.waitingOn} is waiting for your bank to confirm its payment. Open it and confirm that first, then activate this one.`);
    const activationId: Id<"reportActivations"> = await ctx.runMutation(internal.reports.activation.begin, { actor, key, ...(code && { code }) });
    // The workspace's activations one at a time, from the balance as from a purchase: Autumn allowed two holds at once on
    // a balance of one. One pressed meanwhile, in another tab or on another report, waits for this one, then finds the
    // report live or the balance as this one left it.
    return await holdingPurchaseLock(
      ctx,
      workspaceId,
      async (): Promise<{ live: true } | { url: string }> => {
        try {
          // Another tab may have made it live, or another report spent the balance, while this one waited.
          await ctx.runQuery(internal.reports.activation.prepare, { actor, key });
          if (await spend(ctx, first.customerId, activationId)) return { live: true };
          if (!pay) {
            // The page offered one from a balance read before it was spent or reset: it reads the balance again, and
            // then offers what buying one takes.
            await ctx.scheduler.runAfter(0, internal.billing.accounts.refresh, { workspaceId, card: true });
            throw createError("CONFLICT", NONE_LEFT, { reason: "noneLeft" });
          }
          // None left: one is bought. The card is read from Autumn, not the cached account: it may have been removed
          // since. With none, only a code that takes the whole price off buys it.
          const customer = await autumn.customer(first.customerId, { card: true });
          const cardless = !customer.payment_method?.card;
          if (cardless && !code) throw createError("BILLING_CARD_REQUIRED", "Add a payment method to activate.");
          // Nothing is bought while a payment of the customer's is open.
          await payableCustomer(first.customerId, {});
          const quoted = cardless || expect !== undefined ? await autumn.previewAttach(first.customerId, ACTIVATION_PLAN, false, undefined, code).catch(refusedCode<AutumnPreview>(code)) : null;
          // What's due now, after the account's credit, which the page may have read before another purchase spent it.
          if (quoted && expect !== undefined && quoted.total > expect + 0.005) {
            await ctx.scheduler.runAfter(0, internal.billing.accounts.refresh, { workspaceId, card: true });
            const usd = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
            throw createError("CONFLICT", `Activating it now takes ${usd(quoted.total)} from your card, not ${usd(expect)}. Check it and activate again.`);
          }
          // No card: the code has to take the whole price off, before any credit. Then nothing is charged, and Autumn is
          // told so (`unbilled`), or it would send a card-less customer to Stripe's page for $0.
          if (quoted && cardless && linesOf(quoted) > 0.005) throw createError("BILLING_CARD_REQUIRED", `${code} doesn't cover the whole price. Add a payment method to pay the rest.`, { reason: "cardForRest" });
          // Autumn bills by invoice only a customer with an email, and an organisation's has none until a card is saved:
          // it takes its admin's, who is the one activating.
          if (cardless && !customer.email && first.email) await autumn.customer(first.customerId, { email: first.email });
          const charged = await autumn.attach({ customerId: first.customerId, planId: ACTIVATION_PLAN, code, idempotencyKey: nameOf(activationId), successUrl: backTo(first.prefix, key, activationId), ...(cardless && { unbilled: true }) }).catch(refusedCode<AutumnCharge>(code));
          // Declined, its invoice is voided so the decline changes nothing: the next try, with another card or a code,
          // isn't held up by an invoice left open.
          if (charged.required_action?.code === "payment_failed" && charged.invoice?.stripe_id) await voidDeclined(charged.invoice.stripe_id);
          unlessDeclined(charged);
          const done = outcomeOf(charged);
          if (done.kind === "pending") {
            // Autumn's page for it is Stripe's invoice, which has no way back here: the bank's own page comes back to the report.
            const bank = done.invoice ? await bankPage(done.invoice, backTo(first.prefix, key, activationId)) : null;
            console.log(JSON.stringify({ event: "report-activation-pending", key, invoice: done.invoice, action: charged.required_action?.code, back: bank !== null }));
            await ctx.runMutation(internal.reports.activation.settleCharge, { activationId, outcome: { ...done, url: bank ?? done.url } });
            if (bank ?? done.url) return { url: (bank ?? done.url)! };
            throw createError("CONFLICT", STILL_PAYING);
          }
          // Bought: the activation is in the balance now, and this report's to spend.
          if (await spend(ctx, first.customerId, activationId, done.charge)) return { live: true as const };
          throw createError("CONFLICT", KEPT);
        } catch (error) {
          // A refusal bought nothing: the record goes. Anything else may have bought one, its answer lost: Autumn's
          // invoices say what became of it.
          if (boughtNothing(error)) await ctx.runMutation(internal.reports.activation.forget, { activationId });
          else await reconcile(ctx, first.customerId, activationId).catch(() => ctx.scheduler.runAfter(WATCH_FIRST_MS, internal.reports.activation.reconcileLater, { customerId: first.customerId, activationId, attempt: 0 }));
          throw error;
        }
      },
      LOCK_WAIT_MS,
    );
  },
});

/** How long an activation waits for another of its workspace's to finish: far longer than one takes, unless a bank is asked. */
const LOCK_WAIT_MS = 20_000;

/** An error that means nothing was bought: our own refusals, a declined card, a code or a request Autumn refused. */
const boughtNothing = (error: unknown) => error instanceof ConvexError || (error instanceof AutumnError && error.status >= 400 && error.status < 500);

/**
 * Finds what became of a record's purchase whose answer was lost, from the customer's invoices at Autumn: paid, its
 * activation is spent on the report (or kept); open, it waits on the bank like any other; none, nothing was bought
 * (or nothing was owed, and the one bought is in the balance) and the record goes. Throws when Autumn can't be read.
 */
async function reconcile(ctx: ActionCtx, customerId: string, activationId: Id<"reportActivations">) {
  const record: { at: number; charging: boolean } | null = await ctx.runQuery(internal.reports.activation.held, { activationId });
  if (!record?.charging) return;
  // ponytail: the newest activation invoice since the record, allowing for the two servers' clocks. Purchases of a
  // workspace run one at a time, so it is this record's; match on the idempotency key if Autumn ever returns it.
  const invoice = (await autumn.customer(customerId, { invoices: true })).invoices?.find((candidate) => candidate.plan_ids?.includes(ACTIVATION_PLAN) && candidate.created_at >= record.at - 5_000 && candidate.stripe_id);
  console.log(JSON.stringify({ event: "report-activation-reconciled", activationId, invoice: invoice?.stripe_id ?? null, status: invoice?.status ?? null }));
  if (invoice?.status === "paid") await spend(ctx, customerId, activationId, { invoice: invoice.stripe_id!, total: invoice.total, currency: invoice.currency });
  else if (invoice?.status === "open") await ctx.runMutation(internal.reports.activation.settleCharge, { activationId, outcome: { kind: "pending", invoice: invoice.stripe_id!, url: invoice.hosted_invoice_url ?? null } });
  else await ctx.runMutation(internal.reports.activation.forget, { activationId });
}

/** `reconcile` again later, when Autumn couldn't be read at the time, further apart each time. */
export const reconcileLater = internalAction({
  args: { customerId: v.string(), activationId: v.id("reportActivations"), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, { customerId, activationId, attempt }): Promise<null> => {
    try {
      await reconcile(ctx, customerId, activationId);
    } catch (error) {
      console.error(JSON.stringify({ event: "report-activation-unreconciled", activationId, attempt, error: String(error).slice(0, 300) }));
      if (attempt + 1 < FINISH_TRIES) await ctx.scheduler.runAfter(Math.min(WATCH_FIRST_MS * 2 ** (attempt + 1), WATCH_MOST_MS), internal.reports.activation.reconcileLater, { customerId, activationId, attempt: attempt + 1 });
    }
    return null;
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
    const { customerId }: { customerId: string } = await ctx.runQuery(internal.reports.activation.prepare, { actor, key });
    const [plain, discounted] = await Promise.all([autumn.previewAttach(customerId, ACTIVATION_PLAN, false), autumn.previewAttach(customerId, ACTIVATION_PLAN, false, undefined, code).catch(refusedCode<never>(code))]);
    // Read from the quote's lines: its total is what's due after any credit on the account, which a code doesn't change.
    const price = linesOf(plain);
    const total = linesOf(discounted);
    if (total >= price) throw createError("VALIDATION_ERROR", `${code} doesn't take anything off an activation.`, { reason: "nothingOff", code });
    return { price, discount: price - total, total };
  },
});

/** The most Stripe's page is given to say above Save. */
const NOTE_MAX = 300;

/** Stripe's page for saving a card on the workspace's billing account, which comes back to the report. Its admins only. */
export const addCard = action({
  args: { workspaceId: v.id("workspaces"), key: v.string(), /** The code applied in the payment bar, which the way back carries so it needn't be typed again. */ code: v.optional(v.string()), /** What Stripe's page says above Save, in the person's language: that saving a card charges nothing. Theirs alone to read. */ note: v.optional(v.string()), /** The language the person reads the site in, for Stripe's page where Stripe has it. */ locale: v.optional(v.string()) },
  returns: v.string(),
  handler: async (ctx, { workspaceId, key, code: typed, note, locale }): Promise<string> => {
    await refuseApps(ctx);
    const actor = await actorIn(ctx, workspaceId);
    const { prefix, customerId }: { prefix: string; customerId: string } = await ctx.runQuery(internal.reports.activation.prepare, { actor, key });
    // Stripe writes the session's id into the way back, which names the card saved in it.
    const code = codeOf(typed);
    // The code applied goes both ways back: saving a card, and leaving Stripe's page without saving one.
    const carried = code ? `&code=${encodeURIComponent(code)}` : "";
    return (await autumn.setupPayment(customerId, `${backTo(prefix, key)}&session={CHECKOUT_SESSION_ID}${carried}`, { note: note?.trim().slice(0, NOTE_MAX) || undefined, locale, cancelUrl: `${requireAppUrl()}${prefix}/publish?report=${encodeURIComponent(key)}${carried}` })).url;
  },
});

/** How soon a charge waiting on the bank is first looked at, how far apart the looks grow, and how many there are: about two days. */
const WATCH_FIRST_MS = 20_000;
const WATCH_MOST_MS = 60 * 60_000;
const WATCH_LOOKS = 60;

const waitValidator = v.object({ activationId: v.id("reportActivations"), /** The workspace's customer in Autumn. */ customerId: v.string(), invoice: v.string() });
type Wait = Infer<typeof waitValidator>;

/** A charge waiting on the bank, by its record, or null once it's settled. */
export const waitingCharge = internalQuery({
  args: { activationId: v.id("reportActivations") },
  returns: v.union(waitValidator, v.null()),
  handler: async (ctx, { activationId }) => {
    const activation = await ctx.db.get("reportActivations", activationId);
    return activation?.state === "pending" ? { activationId, customerId: await customerOf(ctx, activation.workspaceId), invoice: activation.charge?.invoice ?? "" } : null;
  },
});

/**
 * Settles one waiting charge from its invoice at Stripe, which knows first. Paid, the activation it bought is in the
 * balance and spent on its report; voided, the record goes. A payment the bank or the card refused is voided and
 * dropped too, so Activate starts a new one. Answers how it stands: still `open`, or `settled`.
 */
async function settleOne(ctx: ActionCtx, wait: Wait): Promise<"open" | "settled"> {
  const { activationId, invoice } = wait;
  const charge = await chargeOf(invoice);
  if (charge.status === "open" && !charge.refused) return "open";
  if (charge.status === "open") {
    try {
      await voidInvoice(invoice);
    } catch (error) {
      // Paid meanwhile, from another tab, it's settled as paid; otherwise it's still collectible, and stays watched.
      if ((await chargeOf(invoice)).status === "open") throw error;
      return settleOne(ctx, wait);
    }
  }
  if (charge.status === "paid") {
    // One settlement at a time: another under way finishes it, and this look counts as still open until then.
    if (!(await ctx.runMutation(internal.reports.activation.claimSettle, { activationId }))) return "open";
    await spend(ctx, wait.customerId, activationId, { invoice, total: charge.total, currency: charge.currency });
  } else await ctx.runMutation(internal.reports.activation.settleCharge, { activationId, outcome: { kind: charge.status === "open" ? "refused" : "none" } });
  return "settled";
}

/** Looks at a charge waiting on the bank, and again later, further apart each time, until it's settled or about two days have gone. */
export const watch = internalAction({
  args: { activationId: v.id("reportActivations"), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, { activationId, attempt }): Promise<null> => {
    const waiting: Wait | null = await ctx.runQuery(internal.reports.activation.waitingCharge, { activationId });
    if (!waiting) return null;
    try {
      if ((await settleOne(ctx, waiting)) === "settled") return null;
    } catch (error) {
      // A look that failed (Stripe slow or down) is the next look's to make.
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
  returns: v.array(waitValidator),
  handler: async (ctx, { workspaceId }) => {
    // A workspace has one at most: a new purchase waits until an open payment is paid (billing/purchases.ts).
    const rows = await ctx.db.query("reportActivations").withIndex("by_workspaceId_and_state", (q) => q.eq("workspaceId", workspaceId).eq("state", "pending")).take(5);
    const customerId = await customerOf(ctx, workspaceId);
    return rows.map((row) => ({ activationId: row._id, customerId, invoice: row.charge?.invoice ?? "" }));
  },
});

/**
 * Settles each charge of the workspace that waited on the bank (`settleOne`). Autumn's and Stripe's webhooks call it,
 * and so does the report's page when the bank sends the person back; settling one twice changes nothing.
 */
export async function settlePending(ctx: ActionCtx, workspaceId: Id<"workspaces">) {
  const waits: Wait[] = await ctx.runQuery(internal.reports.activation.waiting, { workspaceId });
  for (const wait of waits) await settleOne(ctx, wait);
}

/**
 * What a report's page does as it opens: a charge of the workspace's that waited on the bank and has been answered
 * since is settled, wherever the person answered it. With `card`, when Stripe sent the person back after saving one or
 * from the bank, the workspace's card is read again first. Otherwise its account is read again behind the page:
 * activations given in Autumn's dashboard send no word of their own, so this is where the page learns of them.
 */
export const settle = action({
  args: {
    workspaceId: v.id("workspaces"),
    card: v.boolean(),
    /** The Checkout session Stripe saved a card in, when it sent the person back from that: the card charged from now on. */
    session: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { workspaceId, card, session }): Promise<null> => {
    await refuseApps(ctx);
    const actor = await actorIn(ctx, workspaceId);
    // Only an admin changes which card the workspace is charged with, as only an admin saves one.
    const savedIn = actor.role === "admin" && session?.startsWith("cs_") ? session : undefined;
    if (card) await refreshAccount(ctx, workspaceId, { card: true, ...(savedIn && { savedIn }) });
    else await ctx.scheduler.runAfter(0, internal.billing.accounts.refresh, { workspaceId });
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
