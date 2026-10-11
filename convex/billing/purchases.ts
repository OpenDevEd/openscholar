// A workspace's purchases (#858): one at a time, and none while a payment of its customer's is still open.

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type ActionCtx } from "../lib/functions";
import { createError } from "../lib/errors";
import { autumn, type AutumnCustomer } from "./autumn";

/** How long a purchase holds its workspace's lock: as long as an action can run, so a live one is never taken over. */
const PURCHASE_LEASE_MS = 10 * 60_000;

/**
 * Refuses anything bought while a payment is still open, a renewal or a charge that was declined: Autumn
 * gives a change made then at once, for nothing, and paying the open invoice finishes the change it was for.
 * `customer` is read with `invoices`.
 */
export function unlessPaymentOpen(customer: AutumnCustomer) {
  const open = customer.invoices?.find((invoice) => invoice.status === "open" && invoice.total > 0);
  if (!open) return;
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: open.currency.toUpperCase() }).format(open.total);
  throw createError("BILLING_PAYMENT_OPEN", `A payment of ${amount} is still open. Pay it first.`, open.hosted_invoice_url ? { url: open.hosted_invoice_url } : undefined);
}

/**
 * Runs `buy` as the workspace's only purchase under way, once no payment of its customer's is open:
 * two at once could both find none open, and Autumn gives the second for nothing when the first was
 * declined. `buy` gets the customer, read with `plans` when asked.
 */
export async function purchasing<T>(ctx: ActionCtx, workspaceId: Id<"workspaces">, customerId: string, read: { plans?: true }, buy: (customer: AutumnCustomer) => Promise<T>): Promise<T> {
  const since: number | null = await ctx.runMutation(internal.billing.purchases.claim, { workspaceId });
  if (since === null) throw createError("BILLING_PLAN_CHANGE_CONFLICT", "Another billing change is under way. Try again in a moment.");
  try {
    const customer = await autumn.customer(customerId, { ...read, invoices: true });
    unlessPaymentOpen(customer);
    return await buy(customer);
  } finally {
    await ctx.runMutation(internal.billing.purchases.release, { workspaceId, since });
  }
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
