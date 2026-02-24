import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  type ClerkUserPayload,
  mapClerkUserToDeleteArgs,
  mapClerkUserToUpsertArgs,
} from "./clerk_mappers";

export function parseClerkUserPayload(data: unknown): ClerkUserPayload | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  const candidate = data as { id?: unknown };
  if (typeof candidate.id !== "string") {
    return null;
  }
  return data as ClerkUserPayload;
}

type ClerkWebhookHandlerOutcome = {
  status: number;
  body: string;
};

type ClerkWebhookMutationRunner = (
  mutation: unknown,
  args: unknown,
) => Promise<unknown>;

type ClerkWebhookMutationRefs = {
  upsertUserFromClerk: unknown;
  markUserDeletedFromClerk: unknown;
};

export async function processClerkWebhookEvent(args: {
  eventId: string;
  eventType: string;
  data: unknown;
  runMutation: ClerkWebhookMutationRunner;
  mutationRefs?: ClerkWebhookMutationRefs;
}): Promise<ClerkWebhookHandlerOutcome> {
  const { eventId, eventType, data, runMutation } = args;
  const mutationRefs = args.mutationRefs ?? {
    upsertUserFromClerk: internal.users.internal.upsertUserFromClerk,
    markUserDeletedFromClerk: internal.users.internal.markUserDeletedFromClerk,
  };

  try {
    switch (eventType) {
      case "user.created":
      case "user.updated": {
        const user = parseClerkUserPayload(data);
        if (!user) {
          return { status: 400, body: "Invalid user payload" };
        }
        await runMutation(mutationRefs.upsertUserFromClerk, mapClerkUserToUpsertArgs(user));
        break;
      }

      case "user.deleted": {
        const user = parseClerkUserPayload(data);
        if (!user) {
          return { status: 400, body: "Invalid user payload" };
        }
        await runMutation(
          mutationRefs.markUserDeletedFromClerk,
          mapClerkUserToDeleteArgs(user),
        );
        break;
      }

      default:
        console.info("[Clerk webhook] Ignored event", { eventId, eventType });
    }

    return { status: 200, body: "OK" };
  } catch (err) {
    console.error("[Clerk webhook] processing error", { eventId, eventType, err });
    return { status: 500, body: "Processing error" };
  }
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
  const outcome = await processClerkWebhookEvent({
    eventId,
    eventType,
    data,
    runMutation: (mutation, mutationArgs) =>
      ctx.runMutation(mutation as never, mutationArgs as never),
  });

  return new Response(outcome.body, { status: outcome.status });
});
