// A workspace's purchases (#858): one at a time, and none while a payment of its customer's is still open.

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type ActionCtx } from "../lib/functions";
import { createError } from "../lib/errors";
import { autumn, type AutumnCustomer } from "./autumn";

/** How long a purchase holds its workspace's lock: as long as an action can run, so a live one is never taken over. */
const PURCHASE_LEASE_MS = 10 * 60_000;

/** Refuses a charge Autumn reports declined: it changed nothing, and the person is told why. */
export function unlessDeclined<T extends { required_action?: { code: string; reason?: string } | null }>(result: T): T {
  if (result.required_action?.code === "payment_failed") throw createError("BILLING_PAYMENT_DECLINED", `${result.required_action.reason ?? "The card was declined."} Nothing was charged.`);
  return result;
}

/**
 * Refuses anything bought while a payment is still open, a renewal or a charge that was declined: Autumn
 * gives a change made then at once, for nothing, and paying the open invoice finishes the change it was for.
 * `customer` is read with `invoices`.
 */
export function unlessPaymentOpen(customer: AutumnCustomer) {
  const open = customer.invoices?.find((invoice) => invoice.status === "open" && invoice.total > 0);
  if (!open) return;
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: open.currency.toUpperCase() }).format(open.total);
  throw createError("BILLING_PAYMENT_OPEN", `A payment of ${amount} is still open. Pay it first.`, { amount: open.total, currency: open.currency, ...(open.hosted_invoice_url ? { url: open.hosted_invoice_url } : {}) });
}

/**
 * Runs `work` as the workspace's only billing change under way: a purchase, or a report's activation spent from its
 * balance, which Autumn's own holds don't keep apart (two at once were both allowed one activation). With `waitMs`,
 * waits up to that long for another to finish first; otherwise, or past it, refuses.
 */
export async function holdingPurchaseLock<T>(ctx: ActionCtx, workspaceId: Id<"workspaces">, work: () => Promise<T>, waitMs = 0): Promise<T> {
  const until = Date.now() + waitMs;
  let since: number | null = await ctx.runMutation(internal.billing.purchases.claim, { workspaceId });
  while (since === null && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, CLAIM_RETRY_MS));
    since = await ctx.runMutation(internal.billing.purchases.claim, { workspaceId });
  }
  if (since === null) throw createError("BILLING_PLAN_CHANGE_CONFLICT", "Another billing change is under way. Try again in a moment.");
  try {
    return await work();
  } finally {
    await ctx.runMutation(internal.billing.purchases.release, { workspaceId, since });
  }
}

/** How often a wait for the purchase lock asks again. */
const CLAIM_RETRY_MS = 500;

/**
 * The customer, read with `invoices` and with `plans` when asked, once no payment of theirs is open: two purchases at
 * once could both find none open, and Autumn gives the second for nothing when the first was declined, so it is read
 * under the purchase lock. `resuming` is a purchase asked again under its own idempotency key, whose open payment, if
 * any, is its own.
 */
export async function payableCustomer(customerId: string, read: { plans?: true; resuming?: true }): Promise<AutumnCustomer> {
  const { resuming, ...reading } = read;
  const customer = await autumn.customer(customerId, { ...reading, invoices: true });
  if (!resuming) unlessPaymentOpen(customer);
  return customer;
}

/** Runs `buy` as the workspace's only billing change under way, once no payment of its customer's is open (`payableCustomer`). */
export async function purchasing<T>(ctx: ActionCtx, workspaceId: Id<"workspaces">, customerId: string, read: { plans?: true; resuming?: true }, buy: (customer: AutumnCustomer) => Promise<T>): Promise<T> {
  return holdingPurchaseLock(ctx, workspaceId, async () => buy(await payableCustomer(customerId, read)));
}

/** Takes the workspace's purchase lock: when it was taken, which lets go of it, or null while another purchase holds it. */
export const claim = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, { workspaceId }) => {
    const row = await ctx.db.query("purchaseLocks").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).unique();
    const now = Date.now();
    if (row && now - row.since < PURCHASE_LEASE_MS) return null;
    if (row) await ctx.db.patch("purchaseLocks", row._id, { since: now });
    else await ctx.db.insert("purchaseLocks", { workspaceId, since: now });
    return now;
  },
});

/** Lets go of the workspace's purchase lock taken at `since`, and of no other. */
export const release = internalMutation({
  args: { workspaceId: v.id("workspaces"), since: v.number() },
  returns: v.null(),
  handler: async (ctx, { workspaceId, since }) => {
    const row = await ctx.db.query("purchaseLocks").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).unique();
    if (row?.since === since) await ctx.db.delete("purchaseLocks", row._id);
    return null;
  },
});
