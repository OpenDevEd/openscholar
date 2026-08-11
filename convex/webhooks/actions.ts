"use node";
import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { Webhook } from "svix";
import { createHash } from "node:crypto";

export type ClerkWebhookVerificationSuccess = {
  success: true;
  eventId: string;
  eventType: string;
  occurredAt: number;
  instanceId: string;
  payloadSha256: string;
  data: string; // JSON-serialized Clerk webhook data
};

export type ClerkWebhookVerificationFailure = {
  success: false;
  error: string;
};

export type ClerkWebhookVerificationResult =
  | ClerkWebhookVerificationSuccess
  | ClerkWebhookVerificationFailure;

export function verifyClerkWebhookPayload(args: {
  payloadText: string;
  svixId: string;
  svixTimestamp: string;
  svixSignature: string;
  webhookSecret?: string;
}): ClerkWebhookVerificationResult {
  const normalizedSecret =
    args.webhookSecret?.trim().replace(/^['"]|['"]$/g, "") ?? "";

  if (!normalizedSecret) {
    return {
      success: false,
      error:
        "CLERK_WEBHOOK_SIGNING_SECRET is not configured for webhook verification.",
    };
  }

  if (!normalizedSecret.startsWith("whsec_")) {
    return {
      success: false,
      error:
        "Invalid CLERK_WEBHOOK_SIGNING_SECRET format. Use the Signing Secret from the Clerk webhook endpoint (whsec_...).",
    };
  }

  const secretBody = normalizedSecret.slice("whsec_".length);
  if (!/^[A-Za-z0-9+/=]+$/.test(secretBody)) {
    return {
      success: false,
      error:
        "Invalid CLERK_WEBHOOK_SIGNING_SECRET format. Use the Signing Secret from the Clerk webhook endpoint (whsec_...).",
    };
  }

  try {
    const webhook = new Webhook(normalizedSecret);
    const verified = webhook.verify(args.payloadText, {
      "svix-id": args.svixId,
      "svix-timestamp": args.svixTimestamp,
      "svix-signature": args.svixSignature,
    }) as Record<string, unknown>;

    const payloadEventType = verified.type;
    const payloadEventAlias = verified.event;
    const payloadTimestamp = verified.timestamp;
    const payloadInstanceId = verified.instance_id;
    const data = verified.data;

    const eventType =
      typeof payloadEventType === "string" && payloadEventType.length > 0
        ? payloadEventType
        : typeof payloadEventAlias === "string" && payloadEventAlias.length > 0
          ? payloadEventAlias
          : null;

    if (!eventType) {
      return {
        success: false,
        error: "Verified webhook payload is missing type.",
      };
    }
    if (!Number.isSafeInteger(payloadTimestamp) || Number(payloadTimestamp) < 0) {
      return {
        success: false,
        error: "Verified webhook payload has an invalid timestamp.",
      };
    }
    if (typeof payloadInstanceId !== "string" || payloadInstanceId.length === 0) {
      return {
        success: false,
        error: "Verified webhook payload is missing instance_id.",
      };
    }

    return {
      success: true,
      eventId: args.svixId,
      eventType,
      occurredAt: Number(payloadTimestamp),
      instanceId: payloadInstanceId,
      payloadSha256: createHash("sha256").update(args.payloadText).digest("hex"),
      data: JSON.stringify(data ?? {}),
    };
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes("Base64Coder: incorrect characters for decoding")
    ) {
      return {
        success: false,
        error:
          "Invalid CLERK_WEBHOOK_SIGNING_SECRET format. Use the Signing Secret from the Clerk webhook endpoint (whsec_...).",
      };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Verifies Clerk webhook signature and returns parsed event.
 */
export const verifyClerkWebhook = internalAction({
  args: {
    payloadText: v.string(),
    svixId: v.string(),
    svixTimestamp: v.string(),
    svixSignature: v.string(),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      eventId: v.string(),
      eventType: v.string(),
      occurredAt: v.number(),
      instanceId: v.string(),
      payloadSha256: v.string(),
      data: v.string(), // JSON-serialized; v.unknown() not available in Convex 1.32.0
    }),
    v.object({
      success: v.literal(false),
      error: v.string(),
    })
  ),
  handler: async (_ctx, args) => {
    return verifyClerkWebhookPayload({
      payloadText: args.payloadText,
      svixId: args.svixId,
      svixTimestamp: args.svixTimestamp,
      svixSignature: args.svixSignature,
      webhookSecret: process.env.CLERK_WEBHOOK_SIGNING_SECRET,
    });
  },
});
