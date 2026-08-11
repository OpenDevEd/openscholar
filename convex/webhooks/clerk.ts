import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  type ClerkUserPayload,
  mapClerkUserToDeleteArgs,
  mapClerkUserToUpsertArgs,
  parseClerkProjectionEvent,
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
  applyOrganizationEvent: unknown;
  applyOrganizationMembershipEvent: unknown;
};

export async function processClerkWebhookEvent(args: {
  eventId: string;
  eventType: string;
  instanceId: string;
  occurredAt: number;
  payloadSha256: string;
  data: unknown;
  runMutation: ClerkWebhookMutationRunner;
  mutationRefs?: Partial<ClerkWebhookMutationRefs>;
}): Promise<ClerkWebhookHandlerOutcome> {
  const { eventId, eventType, instanceId, occurredAt, payloadSha256, data, runMutation } = args;
  const mutationRefs: ClerkWebhookMutationRefs = {
    upsertUserFromClerk: internal.users.internal.upsertUserFromClerk,
    markUserDeletedFromClerk: internal.users.internal.markUserDeletedFromClerk,
    applyOrganizationEvent: internal.webhooks.projections.applyOrganizationEvent,
    applyOrganizationMembershipEvent:
      internal.webhooks.projections.applyOrganizationMembershipEvent,
    ...args.mutationRefs,
  };
  const eventMetadata = {
    eventId,
    eventType,
    instanceId,
    occurredAt,
    payloadSha256,
  };

  try {
    switch (eventType) {
      case "user.created":
      case "user.updated": {
        const user = parseClerkUserPayload(data);
        if (!user) {
          return { status: 400, body: "Invalid user payload" };
        }
        await runMutation(mutationRefs.upsertUserFromClerk, {
          ...eventMetadata,
          ...mapClerkUserToUpsertArgs(user),
        });
        break;
      }

      case "user.deleted": {
        const user = parseClerkUserPayload(data);
        if (!user) {
          return { status: 400, body: "Invalid user payload" };
        }
        await runMutation(
          mutationRefs.markUserDeletedFromClerk,
          {
            ...eventMetadata,
            ...mapClerkUserToDeleteArgs(user),
          },
        );
        break;
      }

      case "organization.created":
      case "organization.updated":
      case "organization.deleted":
      case "organizationMembership.created":
      case "organizationMembership.updated":
      case "organizationMembership.deleted": {
        const projection = parseClerkProjectionEvent(eventType, data);
        if (!projection) {
          return { status: 400, body: "Invalid organization payload" };
        }
        if (projection.kind === "organization") {
          await runMutation(
            mutationRefs.applyOrganizationEvent,
            projection.action === "upsert"
              ? {
                  ...eventMetadata,
                  action: projection.action,
                  entityId: projection.entityId,
                  organization: projection.organization,
                }
              : {
                  ...eventMetadata,
                  action: projection.action,
                  entityId: projection.entityId,
                },
          );
        } else {
          await runMutation(mutationRefs.applyOrganizationMembershipEvent, {
            ...eventMetadata,
            action: projection.action,
            entityId: projection.entityId,
            membership: projection.membership,
          });
        }
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

  const { eventId, eventType, instanceId, occurredAt, payloadSha256, data } = result;
  const parsedData: unknown = JSON.parse(data);
  const outcome = await processClerkWebhookEvent({
    eventId,
    eventType,
    instanceId,
    occurredAt,
    payloadSha256,
    data: parsedData,
    runMutation: (mutation, mutationArgs) =>
      ctx.runMutation(mutation as never, mutationArgs as never),
  });

  return new Response(outcome.body, { status: outcome.status });
});
