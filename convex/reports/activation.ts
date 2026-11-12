// Activating a report (#1261): what makes its DOI live. Only an admin of the report's workspace activates. A report
// costs its licence's price, in US dollars, set on Admin > Publications (`priceOf`). It is paid from the workspace's
// publication balance, which Autumn keeps (lib/billing/plans.ts PUBLICATION_FEATURE): plans and balances given in
// Autumn's dashboard fill it, by the day, week, month or year, or once. The person chooses what pays. From the
// balance, it pays what it can, its refilling part first, and a card buys the rest as dollars of that balance
// (PUBLICATION_TOP_UP_PLAN), spent on the spot. By card, the card buys the whole price and the balance is left as it
// was. A promotion code lowers what the card pays, never what the balance does. A workspace with no saved card pays
// on Stripe's own page, which comes back to the report. A payment still to be made, there or at the bank, waits as
// `pending`, and the report goes live once Stripe has it paid (`settle`). What a card bought for a report that can't
// go live any more stays in the balance for the next one.
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
import { customerOf, publicationOf, readAccount, refreshAccount } from "../billing/accounts";
import { AutumnError, autumn, type AutumnCharge, type AutumnPreview } from "../billing/autumn";
import { readCatalog } from "../billing/catalog";
import { balancePartsValidator } from "../billing/validators";
import { isLockNotFound } from "../billing/charge";
import { holdingPurchaseLock, payableCustomer, unlessDeclined } from "../billing/purchases";
import { bankPage, chargeOf, voidDeclined, voidInvoice } from "../billing/stripeRest";
import { PUBLICATION_FEATURE, PUBLICATION_TOP_UP_PLAN } from "../../lib/billing/plans";
import { CODE_MAX, PRICE_MAX, licenceOf, payment, priceOf, stageOf, type PayWith } from "../../lib/reports/report";
import { canRegister } from "../../lib/reports/settings";
import type { PublicationSettings } from "../evidenceLibraries/publicationValidators";
import { MOVED_ON, byKey, changing, paymentOf, touch, voucherValidator } from "./flow";
import { notify } from "./mail";
import { register } from "./registering";
import { reportSettings } from "./settings";
import { payWithValidator } from "./validators";


/** Where a workspace's report is on Publish: an organisation's pages are under its slug. */
async function placeOf(ctx: QueryCtx, workspaceId: Id<"workspaces">) {
  const workspace = await ctx.db.get("workspaces", workspaceId);
  const organization = workspace?.kind === "organization" ? await ctx.db.get("organizations", workspace.organizationId) : null;
  return { organization: organization?.name ?? null, prefix: organization ? `/o/${organization.slug}` : "" };
}

/** What putting the report live costs, in US dollars, by its licence. */
const priceFor = async (ctx: QueryCtx, report: Doc<"reports">) => priceOf(licenceOf(report), (await reportSettings(ctx)).prices);

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
 * What activating the report takes, for the page that shows its bill: whether the person may pay (an admin of its
 * workspace), what the report costs, the workspace's publication balance, the way of paying and the code kept with the
 * report, and the saved card a charge would go to, if there is one.
 */
export const terms = workspaceQuery({
  args: { key: v.string() },
  returns: v.union(
    v.object({
      admin: v.boolean(),
      /** The organisation the report is in; null for a person's own workspace. */
      organization: v.union(v.string(), v.null()),
      /** The card a charge goes to; null with none saved, when a charge is paid on Stripe's page. */
      card: v.union(cardValidator, v.null()),
      /** Credit on the workspace's Stripe balance, in US dollars, which a charge is paid from first. */
      credit: v.number(),
      /** What the report costs, in US dollars, by its licence. */
      price: v.number(),
      /** What the workspace's publication balance holds, in US dollars, as last read from Autumn; null for no limit. */
      balance: v.union(v.number(), v.null()),
      /** That balance by part: what refills, by when, and what stays until used. */
      parts: balancePartsValidator,
      /** What pays, as last chosen; null before anyone chose, when the balance does while it holds something. */
      payWith: v.union(payWithValidator, v.null()),
      /** The promotion code kept with the report, for what a card pays, with the share it took off when last quoted. */
      voucher: v.union(voucherValidator, v.null()),
      /** Whether Autumn sells the balance at all: without it, what a card would pay can't be paid. */
      sells: v.boolean(),
      /** A payment still to be made: its page, and whether that is Stripe's checkout (true) or the bank's confirmation. */
      pending: v.union(v.object({ url: v.union(v.string(), v.null()), checkout: v.boolean() }), v.null()),
      /** A charge for it is under way, until `until` at the latest, or waits to be paid (`until` null): the report stays as it is until it is answered. */
      paying: v.union(v.object({ until: v.union(v.number(), v.null()) }), v.null()),
      /** The report's last payment wasn't confirmed by the bank: nothing was charged. */
      refused: v.boolean(),
      /** What a card bought for the report went to the balance: it had moved on by then. */
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
    const pending = await pendingOf(ctx, report._id);
    // The last one that came to something: one still under way, or left behind by an action that died, says nothing yet.
    const last = await ctx.db.query("reportActivations").withIndex("by_reportId", (q) => q.eq("reportId", report._id)).order("desc").filter((q) => q.neq(q.field("state"), "charging")).first();
    const account = await readAccount(ctx, actor.workspaceId);
    const settings = await reportSettings(ctx);
    return {
      admin: actor.role === "admin",
      organization: (await placeOf(ctx, actor.workspaceId)).organization,
      card: account?.card ?? null,
      credit: account?.credit ?? 0,
      price: priceOf(licenceOf(report), settings.prices),
      ...publicationOf(account),
      payWith: report.payWith ?? null,
      voucher: report.voucher ? { code: report.voucher, off: report.voucherOff ?? 0 } : null,
      sells: ((await readCatalog(ctx))?.plans ?? []).some((plan) => plan.id === PUBLICATION_TOP_UP_PLAN),
      // The page to pay on is the payer's: an organisation's members see that it waits, not where to pay (billing/accounts.ts `mine`).
      pending: pending ? { url: actor.role === "admin" ? (pending.payUrl ?? null) : null, checkout: !pending.charge?.invoice } : null,
      paying: await paymentOf(ctx, report._id),
      refused: last?.state === "refused",
      kept: last?.state === "unused",
      paused: paused(report, settings.publication),
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
  /** What putting the report live costs, in US dollars, by its licence. */
  price: v.number(),
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
      price: await priceFor(ctx, report),
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

/** The page offered to pay from a balance that isn't what it was any more: spent since, or reset. */
const CHANGED = "The publication balance changed since this page read it. Check what is due, then activate again.";
const STILL_PAYING = "Its payment is still going through. It goes live once it's paid.";
/** Bought, and its report can't go live: what was bought is the balance's. */
const KEPT = "This report can't go live now, so what you paid stays in your publication balance. The next report you activate uses it.";

/**
 * Starts an activation: its record, whose id is the idempotency key of what it buys and names its holds at Autumn,
 * with what pays, the report's price and the code a card's part would be paid with. Refuses while a payment for the
 * report is still to be made.
 */
export const begin = internalMutation({
  args: { actor: actorValidator, key: v.string(), payWith: payWithValidator, code: v.optional(v.string()) },
  returns: v.id("reportActivations"),
  handler: async (ctx, { actor, key, payWith, code }) => {
    const report = await activatable(ctx, actor, key);
    if (await pendingOf(ctx, report._id)) throw createError("CONFLICT", STILL_PAYING);
    return await ctx.db.insert("reportActivations", { workspaceId: actor.workspaceId, reportId: report._id, at: Date.now(), by: actor.userId, state: "charging", payWith, price: await priceFor(ctx, report), ...(code && { code }) });
  },
});

/** What a card buys for an activation, in dollars of the balance: kept with its record once that is known. */
export const buying = internalMutation({
  args: { activationId: v.id("reportActivations"), bought: v.number() },
  returns: v.null(),
  handler: async (ctx, { activationId, bought }) => {
    if (await ctx.db.get("reportActivations", activationId)) await ctx.db.patch("reportActivations", activationId, { bought });
    return null;
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
  /** The report's price is held for it in the balance, under `hold`: the report goes live. `charge`: what a card paid toward it. */
  v.object({ kind: v.literal("held"), hold: v.string(), charge: v.optional(chargeValidator) }),
  /** A card bought toward it, and the balance couldn't hold its price: kept, with the report as it was. */
  v.object({ kind: v.literal("bought"), charge: chargeValidator }),
  v.object({ kind: v.literal("pending"), invoice: v.string(), url: v.union(v.string(), v.null()) }),
  v.object({ kind: v.literal("none") }),
  v.object({ kind: v.literal("refused") }),
);

/**
 * Records what became of an activation, and answers whether its report is live by it. Held: the report goes live, as
 * its admin asked. A report that moved on meanwhile is refused, or when the activation was bought for it, the record is
 * kept `unused` and whoever pays is told what they paid stays in the balance. Still to be paid: `pending`, with the
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
    const stopped: unknown = outcome.kind === "bought" ? "The balance couldn't hold the report's price." : report ? await readyToGoLive(ctx, report).then(() => null, (error: unknown) => error) : createError("NOT_FOUND", MOVED_ON);
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

/**
 * A record as finishing it needs it: its workspace and that workspace's customer in Autumn, the hold its report went
 * live by if it did, whether it is still under way, what pays, and the report's price; null once the record is gone.
 */
export const held = internalQuery({
  args: { activationId: v.id("reportActivations") },
  returns: v.union(v.object({ workspaceId: v.id("workspaces"), customerId: v.string(), hold: v.union(v.string(), v.null()), at: v.number(), charging: v.boolean(), payWith: payWithValidator, price: v.number() }), v.null()),
  handler: async (ctx, { activationId }) => {
    const activation = await ctx.db.get("reportActivations", activationId);
    if (!activation) return null;
    const report = await ctx.db.get("reports", activation.reportId);
    return {
      workspaceId: activation.workspaceId,
      customerId: await customerOf(ctx, activation.workspaceId),
      hold: activation.state === "live" ? (activation.hold ?? null) : null,
      at: activation.at,
      charging: activation.state === "charging",
      payWith: activation.payWith ?? "balance",
      // As it was when the activation began; a record from before prices were kept takes the report's own.
      price: activation.price ?? (report ? await priceFor(ctx, report) : 0),
    };
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

/** The end of the name a record's hold takes when a card bought its whole price: nothing is held at Autumn for it. */
const BOUGHT = "-bought";

/**
 * Takes a report's price from what stays in the customer's balance, never from a part that refills: a card bought
 * that much for it, so the balance is left as it was. From the one entry that holds the most, which is the one just
 * bought or one like it. `key` names the taking, so asked twice it is taken once.
 */
async function takeKept(customerId: string, price: number, key: string) {
  const kept = ((await autumn.customer(customerId)).balances[PUBLICATION_FEATURE]?.breakdown ?? []).filter((grant) => !grant.reset?.interval || grant.reset.interval === "one_off").sort((a, b) => b.remaining - a.remaining)[0];
  if (!kept || kept.remaining < price) console.error(JSON.stringify({ event: "report-activation-kept-short", customerId, key, price, holds: kept?.remaining ?? 0 }));
  if (!kept) return;
  try {
    await autumn.takeFrom({ customerId, feature: PUBLICATION_FEATURE, balanceId: kept.id, amount: Math.min(price, kept.remaining), idempotencyKey: key });
  } catch (error) {
    // Taken already, by an earlier try.
    if (!(error instanceof AutumnError && error.code === "duplicate_idempotency_key")) throw error;
  }
}

/**
 * Finishes one hold: the report's price is taken when the record's report went live by this very hold, and given
 * back otherwise, so a second hold on a record already settled never takes a second price. A hold on the balance is
 * finished at Autumn; one whose price a card bought (`BOUGHT`) takes that price from what stays in the balance. A
 * hold already finished changes nothing. The workspace's balance is read again after (`finished`).
 */
async function finish(ctx: ActionCtx, activationId: Id<"reportActivations">, hold: string) {
  const record: { workspaceId: Id<"workspaces">; customerId: string; hold: string | null; price: number } | null = await ctx.runQuery(internal.reports.activation.held, { activationId });
  if (hold.endsWith(BOUGHT)) {
    if (record?.hold === hold) await takeKept(record.customerId, record.price, hold);
  } else {
    try {
      await autumn.finalize(hold, record?.hold === hold ? "confirm" : "release");
    } catch (error) {
      if (!isLockNotFound(error)) throw error;
    }
  }
  await ctx.runMutation(internal.reports.activation.finished, { activationId });
}

/**
 * Says a record's hold is finished at Autumn, and has the workspace's account read again: only a balance read after
 * this is shown, so the page never sees a report live and its price not yet taken (billing/accounts.ts `payingForReport`).
 */
export const finished = internalMutation({
  args: { activationId: v.id("reportActivations") },
  returns: v.null(),
  handler: async (ctx, { activationId }) => {
    const activation = await ctx.db.get("reportActivations", activationId);
    if (!activation) return null;
    await ctx.db.patch("reportActivations", activationId, { finishedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.billing.accounts.refresh, { workspaceId: activation.workspaceId, card: true });
    return null;
  },
});

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
 * Spends the report's `price` from the customer's balance, its refilling part first: held at Autumn under a name of
 * this try's own, the report put live, then taken, or given back when the report couldn't go live or was live
 * already. `charge` is what a card paid toward it: with one, a price that can't be held or spent is kept on record
 * all the same. Answers whether the report is live by this record. False with nothing bought means the balance
 * didn't hold the price.
 */
async function spend(ctx: ActionCtx, customerId: string, activationId: Id<"reportActivations">, price: number, charge?: Infer<typeof chargeValidator>): Promise<boolean> {
  const hold = `${nameOf(activationId)}-${crypto.randomUUID()}`;
  const record = (outcome: Infer<typeof outcomeValidator>): Promise<boolean> => ctx.runMutation(internal.reports.activation.settleCharge, { activationId, outcome });
  let holding = false;
  try {
    await ctx.scheduler.runAfter(HOLD_MS, internal.reports.activation.finishHold, { activationId, hold, attempt: 0 });
    holding = (await autumn.lock({ customerId, feature: PUBLICATION_FEATURE, credits: price, lockId: hold, expiresAt: Date.now() + HOLD_MS })).allowed;
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

/**
 * Puts the report live on what a card bought for it, the whole of its price, and takes that price from what stays in
 * the balance, so paying by card leaves the balance as it was. Nothing is held at Autumn: the workspace's
 * activations run one at a time, and what was bought is this report's alone until it is live. A report that can't go
 * live keeps what was bought in the balance (`settleCharge`). Answers whether the report is live by this record.
 */
async function spendBought(ctx: ActionCtx, activationId: Id<"reportActivations">, charge: Infer<typeof chargeValidator>): Promise<boolean> {
  const hold = `${nameOf(activationId)}${BOUGHT}`;
  const live: boolean = await ctx.runMutation(internal.reports.activation.settleCharge, { activationId, outcome: { kind: "held", hold, charge } });
  if (!live) return false;
  // Taken now, and again later by its own name if Autumn can't be reached now: asked twice, it is taken once.
  await ctx.scheduler.runAfter(HOLD_MS, internal.reports.activation.finishHold, { activationId, hold, attempt: 0 });
  await finish(ctx, activationId, hold).catch((error: unknown) => console.error(JSON.stringify({ event: "report-activation-hold-unfinished", activationId, hold, error: String(error).slice(0, 300) })));
  return true;
}

/** Spends what a card paid toward the record's report, as the record says it pays: through the balance, or the card's own dollars. */
const spendPaid = (ctx: ActionCtx, customerId: string, activationId: Id<"reportActivations">, how: { payWith: PayWith; price: number }, charge: Infer<typeof chargeValidator>) =>
  how.payWith === "card" ? spendBought(ctx, activationId, charge) : spend(ctx, customerId, activationId, how.price, charge);

/** What Autumn answered to a charge: paid, or still to be paid, on Stripe's page or at the bank. */
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

/** What a quote's lines come to, in US dollars, before any credit on the account. */
const linesOf = (preview: AutumnPreview) => preview.line_items.reduce((sum, line) => sum + line.total, 0);
const usd = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
/** So many dollars of the publication balance, as the top-up plan sells them. */
const dollars = (amount: number) => ({ feature: PUBLICATION_FEATURE, amount });

/**
 * Activates the report, paid as `payWith` says. From the balance: it pays what it can, its refilling part first, and
 * a card buys the rest. By card: the card buys the whole price and the balance is left as it was. `code` lowers what
 * the card pays. With nothing for a card to pay, nothing is charged. With something, a saved card is charged, and a
 * workspace with none pays on Stripe's page; a code that takes it all off needs neither. `expect` is what the person
 * was shown as due, in US dollars: a charge that would take more is refused, never made. Answers `live`, or the page
 * to pay or confirm on, after which the report goes live by itself.
 */
export const activate = action({
  args: {
    workspaceId: v.id("workspaces"),
    key: v.string(),
    payWith: payWithValidator,
    code: v.optional(v.string()),
    /** What the person was shown as due, in US dollars. */
    expect: v.optional(v.number()),
  },
  returns: v.union(v.object({ live: v.literal(true) }), v.object({ url: v.string() })),
  handler: async (ctx, { workspaceId, key, payWith, code: typed, expect }): Promise<{ live: true } | { url: string }> => {
    await refuseApps(ctx);
    const actor = await actorIn(ctx, workspaceId);
    const code = codeOf(typed);
    const first: Prepared = await ctx.runQuery(internal.reports.activation.prepare, { actor, key });
    if (first.pending) {
      if (first.pending.url) return { url: first.pending.url };
      throw createError("CONFLICT", STILL_PAYING);
    }
    // What that payment buys lands in the same balance: nothing else is spent from it until that report has its own.
    if (first.waitingOn) throw createError("CONFLICT", `${first.waitingOn} is waiting for its payment. Open it and finish or cancel that first, then activate this one.`);
    // The workspace's activations one at a time, from the balance as from a purchase: Autumn allowed two holds at once on
    // a balance that covered one. One pressed meanwhile, in another tab or on another report, waits for this one, then
    // finds the report live or the balance as this one left it.
    return await holdingPurchaseLock(
      ctx,
      workspaceId,
      async (): Promise<{ live: true } | { url: string }> => {
        // Recorded only once the lock is held, so an activation that never got it leaves nothing behind. Refused when
        // another tab made the report live, or its payment is still to be made, while this one waited.
        const activationId: Id<"reportActivations"> = await ctx.runMutation(internal.reports.activation.begin, { actor, key, payWith, ...(code && { code }) });
        // The page read the balance before this; what is refused here sends it to read again.
        const changed = async (message: string): Promise<never> => {
          await ctx.scheduler.runAfter(0, internal.billing.accounts.refresh, { workspaceId, card: true });
          throw createError("CONFLICT", message, { reason: "changed" });
        };
        try {
          // The balance and the card are read from Autumn, not the cached account: another report may have spent the
          // balance while this one waited, and the card may have been removed since.
          const customer = await autumn.customer(first.customerId, { card: true });
          const held = customer.balances[PUBLICATION_FEATURE];
          const { bought } = payment({ price: first.price, balance: held?.unlimited ? null : (held?.remaining ?? 0), payWith, off: 0 });
          if (bought === 0) {
            // The balance covers it: nothing is bought, whatever card or code there is.
            if (await spend(ctx, first.customerId, activationId, first.price)) return { live: true };
            return await changed(CHANGED);
          }
          await ctx.runMutation(internal.reports.activation.buying, { activationId, bought });
          // Nothing is bought while a payment of the customer's is open.
          await payableCustomer(first.customerId, {});
          const quoted = await autumn.previewAttach(first.customerId, PUBLICATION_TOP_UP_PLAN, false, undefined, code, dollars(bought)).catch(refusedCode<AutumnPreview>(code));
          // What's due now, after the account's credit: more than the page showed (the balance was spent or reset, a
          // price changed, the credit went) is never charged without the person seeing it.
          if (expect !== undefined && quoted.total > expect + 0.005) return await changed(`Activating it now takes ${usd(quoted.total)}, not ${usd(expect)}. Check it and activate again.`);
          const cardless = !customer.payment_method?.card;
          // Nothing for a card to pay, before any credit: a code took it all off. Autumn is told so (`unbilled`), or it
          // would send a customer with no card to Stripe's page for $0.
          const free = linesOf(quoted) <= 0.005;
          // Autumn bills by invoice only a customer with an email, and an organisation's has none until someone pays:
          // it takes its admin's, who is the one activating.
          if (cardless && !customer.email && first.email) await autumn.customer(first.customerId, { email: first.email });
          // With no saved card and something to pay, Autumn answers Stripe's page for it, which comes back to the report.
          const charged = await autumn.attach({ customerId: first.customerId, planId: PUBLICATION_TOP_UP_PLAN, quantity: dollars(bought), code, idempotencyKey: nameOf(activationId), successUrl: backTo(first.prefix, key, activationId), ...(cardless && free && { unbilled: true }) }).catch(refusedCode<AutumnCharge>(code));
          // Declined, its invoice is voided so the decline changes nothing: the next try, with another card or a code,
          // isn't held up by an invoice left open.
          if (charged.required_action?.code === "payment_failed" && charged.invoice?.stripe_id) await voidDeclined(charged.invoice.stripe_id);
          unlessDeclined(charged);
          const done = outcomeOf(charged);
          if (done.kind === "pending") {
            // Stripe's checkout comes back by itself. The bank's confirmation is Stripe's invoice page, which has no way
            // back here: the bank's own page comes back to the report.
            const bank = done.invoice ? await bankPage(done.invoice, backTo(first.prefix, key, activationId)) : null;
            console.log(JSON.stringify({ event: "report-activation-pending", key, invoice: done.invoice, checkout: !done.invoice, action: charged.required_action?.code, back: bank !== null }));
            await ctx.runMutation(internal.reports.activation.settleCharge, { activationId, outcome: { ...done, url: bank ?? done.url } });
            if (bank ?? done.url) return { url: (bank ?? done.url)! };
            throw createError("CONFLICT", STILL_PAYING);
          }
          // Bought: the dollars are in the balance now, and this report's to spend.
          if (await spendPaid(ctx, first.customerId, activationId, { payWith, price: first.price }, done.charge)) return { live: true as const };
          throw createError("CONFLICT", KEPT);
        } catch (error) {
          // A refusal bought nothing: the record goes. Anything else may have bought something, its answer lost:
          // Autumn's invoices say what became of it.
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

/** The customer's invoice for what a record bought: the newest for the top-up plan since the record began; undefined when there is none yet. */
async function invoiceSince(customerId: string, at: number) {
  // ponytail: the newest top-up invoice since the record, allowing for the two servers' clocks. Purchases of a
  // workspace run one at a time, so it is this record's; match on the idempotency key if Autumn ever returns it.
  return (await autumn.customer(customerId, { invoices: true })).invoices?.find((candidate) => candidate.plan_ids?.includes(PUBLICATION_TOP_UP_PLAN) && candidate.created_at >= at - 5_000 && candidate.stripe_id);
}

/**
 * Finds what became of a record's purchase whose answer was lost, from the customer's invoices at Autumn: paid, what
 * it bought is spent on the report (or kept); open, it waits to be paid like any other; none, nothing was bought
 * (or nothing was owed, and what was given is in the balance) and the record goes. Throws when Autumn can't be read.
 */
async function reconcile(ctx: ActionCtx, customerId: string, activationId: Id<"reportActivations">) {
  const record: { at: number; charging: boolean; payWith: PayWith; price: number } | null = await ctx.runQuery(internal.reports.activation.held, { activationId });
  if (!record?.charging) return;
  const invoice = await invoiceSince(customerId, record.at);
  console.log(JSON.stringify({ event: "report-activation-reconciled", activationId, invoice: invoice?.stripe_id ?? null, status: invoice?.status ?? null }));
  if (invoice?.status === "paid") await spendPaid(ctx, customerId, activationId, record, { invoice: invoice.stripe_id!, total: invoice.total, currency: invoice.currency });
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

/**
 * What `code` takes off what a card buys of the publication balance, as the share Autumn quotes on `amount` dollars
 * of it (0 to 1), so a page can say what a card would pay with it: before a report is started, where its licence is
 * chosen, and wherever its bill shows after.
 * ponytail: a code is taken as a share of what is bought, which every code we give out is. One that takes a fixed
 * amount off would be quoted for each amount; the charge itself is always Autumn's own sum, checked against what the
 * page showed (`activate`'s `expect`).
 */
export const quoteCode = action({
  args: { workspaceId: v.id("workspaces"), code: v.string(), /** What a card would buy now, in whole US dollars. */ amount: v.number() },
  returns: v.object({ off: v.number() }),
  handler: async (ctx, { workspaceId, code: typed, amount }): Promise<{ off: number }> => {
    await refuseApps(ctx);
    const actor = await actorIn(ctx, workspaceId);
    const code = codeOf(typed);
    if (!code) throw createError("VALIDATION_ERROR", "Type a code first.");
    const customerId: string = await ctx.runQuery(internal.billing.accounts.customerFor, { workspaceId: actor.workspaceId });
    const bought = dollars(Math.min(Math.max(Math.ceil(amount), 1), PRICE_MAX));
    const [plain, discounted] = await Promise.all([autumn.previewAttach(customerId, PUBLICATION_TOP_UP_PLAN, false, undefined, undefined, bought), autumn.previewAttach(customerId, PUBLICATION_TOP_UP_PLAN, false, undefined, code, bought).catch(refusedCode<never>(code))]);
    // Read from the quote's lines: its total is what's due after any credit on the account, which a code doesn't change.
    const price = linesOf(plain);
    const total = linesOf(discounted);
    if (price <= 0 || total >= price) throw createError("VALIDATION_ERROR", `${code} doesn't take anything off publishing a report.`, { reason: "nothingOff", code });
    return { off: (price - total) / price };
  },
});

/** How soon a payment still to be made is first looked at, how far apart the looks grow, and how many there are: about two days. */
const WATCH_FIRST_MS = 20_000;
const WATCH_MOST_MS = 60 * 60_000;
const WATCH_LOOKS = 60;

const waitValidator = v.object({
  activationId: v.id("reportActivations"),
  /** The workspace's customer in Autumn. */
  customerId: v.string(),
  /** Its invoice at Stripe; none while it is to be paid on Stripe's checkout, which makes one only once paid. */
  invoice: v.string(),
  /** When the activation began: its invoice, once there is one, is the customer's newest since. */
  at: v.number(),
  payWith: payWithValidator,
  /** What its report costs, in US dollars. */
  price: v.number(),
});
type Wait = Infer<typeof waitValidator>;

/** A record as a wait: with its customer, and what settling it spends. */
async function waitOf(ctx: QueryCtx, row: Doc<"reportActivations">, customerId: string): Promise<Wait> {
  const report = await ctx.db.get("reports", row.reportId);
  return { activationId: row._id, customerId, invoice: row.charge?.invoice ?? "", at: row.at, payWith: row.payWith ?? "balance", price: row.price ?? (report ? await priceFor(ctx, report) : 0) };
}

/** A payment still to be made, by its record, or null once it's settled. */
export const waitingCharge = internalQuery({
  args: { activationId: v.id("reportActivations") },
  returns: v.union(waitValidator, v.null()),
  handler: async (ctx, { activationId }) => {
    const activation = await ctx.db.get("reportActivations", activationId);
    return activation?.state === "pending" ? await waitOf(ctx, activation, await customerOf(ctx, activation.workspaceId)) : null;
  },
});

/**
 * Settles one payment still to be made. One the bank was asked to confirm is read from its invoice at Stripe, which
 * knows first. One made on Stripe's checkout has no invoice until it is paid: the customer's newest for the balance
 * since the activation began is it. Paid, what it bought is in the balance and spent on its report; voided, the
 * record goes. A payment the bank or the card refused is voided and dropped too, so Activate starts a new one.
 * Answers how it stands: still `open`, or `settled`.
 */
async function settleOne(ctx: ActionCtx, wait: Wait): Promise<"open" | "settled"> {
  const { activationId } = wait;
  const invoice = wait.invoice || (await invoiceSince(wait.customerId, wait.at))?.stripe_id;
  // Stripe's checkout, not paid yet, or left.
  if (!invoice) return "open";
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
    await spendPaid(ctx, wait.customerId, activationId, wait, { invoice, total: charge.total, currency: charge.currency });
  } else await ctx.runMutation(internal.reports.activation.settleCharge, { activationId, outcome: { kind: charge.status === "open" ? "refused" : "none" } });
  return "settled";
}

/** Looks at a payment still to be made, and again later, further apart each time, until it's settled or about two days have gone. */
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
    else if (!waiting.invoice) {
      // Stripe's checkout is long shut by now (it lasts a day): nothing was paid, and the record goes, so the report
      // can be activated again. Paid after all, what it bought is in the balance.
      console.log(JSON.stringify({ event: "report-activation-checkout-left", activationId }));
      await ctx.runMutation(internal.reports.activation.settleCharge, { activationId, outcome: { kind: "none" } });
    } else console.error(JSON.stringify({ event: "report-activation-unsettled", activationId, invoice: waiting.invoice }));
    return null;
  },
});

/** The workspace's payments still to be made. */
export const waiting = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(waitValidator),
  handler: async (ctx, { workspaceId }) => {
    // A workspace has one at most: a new purchase waits until an open payment is paid (billing/purchases.ts).
    const rows = await ctx.db.query("reportActivations").withIndex("by_workspaceId_and_state", (q) => q.eq("workspaceId", workspaceId).eq("state", "pending")).take(5);
    const customerId = await customerOf(ctx, workspaceId);
    return await Promise.all(rows.map((row) => waitOf(ctx, row, customerId)));
  },
});

/**
 * Settles each payment of the workspace that was still to be made (`settleOne`). Autumn's and Stripe's webhooks call
 * it, and so does the report's page when Stripe or the bank sends the person back; settling one twice changes nothing.
 */
export async function settlePending(ctx: ActionCtx, workspaceId: Id<"workspaces">) {
  const waits: Wait[] = await ctx.runQuery(internal.reports.activation.waiting, { workspaceId });
  for (const wait of waits) await settleOne(ctx, wait);
}

/**
 * What a report's page does as it opens: a payment of the workspace's that was still to be made and has been made
 * since is settled, wherever the person paid it. With `card`, when Stripe or the bank sent the person back, the
 * workspace's account is read again first. Otherwise it is read again behind the page: a balance given in Autumn's
 * dashboard sends no word of its own, so this is where the page learns of it.
 */
export const settle = action({
  args: { workspaceId: v.id("workspaces"), card: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { workspaceId, card }): Promise<null> => {
    await refuseApps(ctx);
    await actorIn(ctx, workspaceId);
    // Settled first: a payment just made on Stripe's page is spent on its report before the balance is read, so the
    // page never shows it bought and not yet spent.
    await settlePending(ctx, workspaceId);
    if (card) await refreshAccount(ctx, workspaceId, { card: true });
    else await ctx.scheduler.runAfter(0, internal.billing.accounts.refresh, { workspaceId });
    return null;
  },
});

/**
 * Gives up a payment of the report's that is still to be made, so the report can be changed or paid another way: its
 * admin's alone. Made after all (the person paid on Stripe's page in another tab), it is settled as paid instead. A
 * confirmation the bank was asked for is voided at Stripe. A checkout left open can still be paid until Stripe shuts
 * it, a day on: what it buys then stays in the balance.
 */
export const cancelPayment = action({
  args: { workspaceId: v.id("workspaces"), key: v.string() },
  returns: v.null(),
  handler: async (ctx, { workspaceId, key }): Promise<null> => {
    await refuseApps(ctx);
    const actor = await actorIn(ctx, workspaceId);
    if (actor.role !== "admin") throw createError("FORBIDDEN", "Only an admin of the workspace gives up its payment.");
    const wait: Wait | null = await ctx.runQuery(internal.reports.activation.waitingFor, { actor, key });
    if (!wait) return null;
    // Paid meanwhile, or refused: settled as that.
    if ((await settleOne(ctx, wait)) === "settled") return null;
    if (wait.invoice) {
      await voidInvoice(wait.invoice).catch(async (error: unknown) => {
        // Paid in the moment since: it is settled as paid by the next look.
        if ((await chargeOf(wait.invoice)).status === "open") throw error;
      });
      if ((await settleOne(ctx, wait)) === "settled") return null;
    }
    await ctx.runMutation(internal.reports.activation.settleCharge, { activationId: wait.activationId, outcome: { kind: "none" } });
    return null;
  },
});

/** The report's payment still to be made, as a wait, for the one giving it up; null with none. */
export const waitingFor = internalQuery({
  args: { actor: actorValidator, key: v.string() },
  returns: v.union(waitValidator, v.null()),
  handler: async (ctx, { actor, key }) => {
    const report = await changing(ctx, actor, key);
    const pending = await pendingOf(ctx, report._id);
    return pending ? await waitOf(ctx, pending, await customerOf(ctx, actor.workspaceId)) : null;
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
