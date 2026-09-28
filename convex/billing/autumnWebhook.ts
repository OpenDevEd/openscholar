/**
 * Autumn's webhooks, delivered through our self-hosted Svix. Any customer
 * event (a plan attached, cancelled or renewed, a balance alert) refreshes
 * that user's cached account, so changes made in Autumn's dashboard reach the
 * app without the user doing anything.
 */
import { v } from "convex/values";
import { httpAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { refreshAccount } from "./accounts";

/** Svix signs each delivery; older timestamps are rejected as replays. */
const TOLERANCE_SECONDS = 5 * 60;

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Checks a Standard Webhooks signature, the scheme Svix uses: HMAC-SHA256 of
 * `id.timestamp.body` with the endpoint secret, base64, as `v1,<signature>`.
 */
export async function verifySvixSignature(args: {
  secret: string;
  id: string;
  timestamp: string;
  signatures: string;
  body: string;
  nowSeconds: number;
}): Promise<boolean> {
  const sentAt = Number(args.timestamp);
  if (!Number.isFinite(sentAt) || Math.abs(args.nowSeconds - sentAt) > TOLERANCE_SECONDS) {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    base64ToBytes(args.secret.replace(/^whsec_/, "")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = bytesToBase64(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${args.id}.${args.timestamp}.${args.body}`),
    ),
  );
  return args.signatures
    .split(" ")
    .some((entry) => entry.startsWith("v1,") && constantTimeEqual(entry.slice(3), expected));
}

export const autumnWebhook = httpAction(async (ctx, request) => {
  const secret = process.env.AUTUMN_WEBHOOK_SECRET;
  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signatures = request.headers.get("svix-signature");
  if (!secret || !id || !timestamp || !signatures) {
    return new Response("Missing Svix headers or secret", { status: 400 });
  }
  const body = await request.text();
  const valid = await verifySvixSignature({
    secret,
    id,
    timestamp,
    signatures,
    body,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (!valid) {
    console.error(`[autumn webhook] rejected ${id}: bad signature or stale timestamp`);
    return new Response("Invalid signature", { status: 401 });
  }

  const event = JSON.parse(body) as {
    type?: string;
    data?: { customer?: { id?: string }; customer_id?: string };
  };
  const customerId = event.data?.customer?.id ?? event.data?.customer_id;
  if (!customerId) {
    console.warn(`[autumn webhook] ${event.type ?? "event"} ${id} names no customer`);
    return new Response(null, { status: 204 });
  }
  const userId = await ctx.runQuery(internal.billing.autumnWebhook.userForCustomer, { customerId });
  if (!userId) {
    console.warn(`[autumn webhook] no OpenScholar user for Autumn customer ${customerId}`);
    return new Response(null, { status: 204 });
  }
  // Refreshed before answering, so a failure here makes Svix retry.
  try {
    await refreshAccount(ctx, userId);
  } catch (error) {
    console.error(`[autumn webhook] refresh for ${customerId} failed on ${id}`, error);
    return new Response("Refresh failed", { status: 500 });
  }
  return new Response(null, { status: 204 });
});

/** The OpenScholar user an Autumn customer id belongs to; they're the same id. */
export const userForCustomer = internalQuery({
  args: { customerId: v.string() },
  returns: v.union(v.id("users"), v.null()),
  handler: async (ctx, { customerId }) => {
    const userId = ctx.db.normalizeId("users", customerId);
    return userId && (await ctx.db.get("users", userId)) ? userId : null;
  },
});
