import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  type ClerkUserPayload,
  mapClerkUserToDeleteArgs,
  mapClerkUserToUpsertArgs,
} from "./clerk_mappers";

function parseUserPayload(data: unknown): ClerkUserPayload | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  const candidate = data as { id?: unknown };
  if (typeof candidate.id !== "string") {
    return null;
  }
  return data as ClerkUserPayload;
}

export const clerkWebhook = httpAction(async (ctx, req) => {
  const payloadText = await req.text();
  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response("Missing Svix signature headers", { status: 401 });
  }

  const result = await ctx.runAction(internal.webhooks.actions.verifyClerkWebhook, {
    payloadText,
    svixId,
    svixTimestamp,
    svixSignature,
  });

  if (!result.success) {
    console.error("Clerk webhook verification failed:", result.error);
    return new Response("Invalid signature", { status: 401 });
  }

  const { eventId, eventType, data } = result;

  try {
    switch (eventType) {
      case "user.created":
      case "user.updated": {
        const user = parseUserPayload(data);
        if (!user) {
          return new Response("Invalid user payload", { status: 400 });
        }
        await ctx.runMutation(
          internal.users.internal.upsertUserFromClerk,
          mapClerkUserToUpsertArgs(user),
        );
        break;
      }

      case "user.deleted": {
        const user = parseUserPayload(data);
        if (!user) {
          return new Response("Invalid user payload", { status: 400 });
        }
        await ctx.runMutation(
          internal.users.internal.markUserDeletedFromClerk,
          mapClerkUserToDeleteArgs(user),
        );
        break;
      }

      default:
        console.info("[Clerk webhook] Ignored event", { eventId, eventType });
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("[Clerk webhook] processing error", { eventId, eventType, err });
    return new Response("Processing error", { status: 500 });
  }
});
