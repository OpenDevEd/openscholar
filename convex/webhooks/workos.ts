import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  type WorkOSMembershipPayload,
  type WorkOSOrgPayload,
  type WorkOSUserPayload,
  mapWorkosMembershipToRemoveArgs,
  mapWorkosMembershipToSyncArgs,
  mapWorkosUserToSyncArgs,
} from "./workos-mappers";

export const workosWebhook = httpAction(async (ctx, req) => {
  const payloadText = await req.text();
  const sigHeader = req.headers.get("workos-signature");

  if (!sigHeader) {
    return new Response("Missing signature", { status: 401 });
  }

  // Verify signature using Node.js action
  const result = await ctx.runAction(internal.webhooks.actions.verifyWorkosWebhook, {
    payloadText,
    signature: sigHeader,
  });

  if (!result.success) {
    console.error("WorkOS webhook verification failed:", result.error);
    return new Response("Invalid signature", { status: 401 });
  }

  const { eventId, event, data } = result;

  try {
    switch (event) {
      // ── User Events ──────────────────────────────────────────────
      case "user.created":
      case "user.updated": {
        const user = data as unknown as WorkOSUserPayload;
        const mutation =
          event === "user.created"
            ? internal.users.internal.syncUserFromWorkos
            : internal.users.internal.updateUserFromWorkos;

        await ctx.runMutation(mutation, mapWorkosUserToSyncArgs(user));
        break;
      }

      case "user.deleted": {
        const user = data as unknown as WorkOSUserPayload;
        await ctx.runMutation(internal.users.internal.markUserDeleted, {
          workosId: user.id,
        });
        break;
      }

      // ── Organization Events ──────────────────────────────────────
      case "organization.created":
      case "organization.updated": {
        const org = data as unknown as WorkOSOrgPayload;
        const mutation =
          event === "organization.created"
            ? internal.organizations.internal.syncOrgFromWorkos
            : internal.organizations.internal.updateOrgFromWorkos;

        await ctx.runMutation(mutation, {
          workosId: org.id,
          name: org.name,
        });
        break;
      }

      case "organization.deleted": {
        const org = data as unknown as WorkOSOrgPayload;
        const organizationsInternal = (internal as any).organizations.internal;
        await ctx.runMutation(organizationsInternal.markOrgDeletedFromWorkos, {
          workosId: org.id,
        });
        break;
      }

      // ── Membership Events ────────────────────────────────────────
      case "organization_membership.created":
      case "organization_membership.updated": {
        const membership = data as unknown as WorkOSMembershipPayload;
        const mutation =
          event === "organization_membership.created"
            ? internal.memberships.internal.syncMembershipFromWorkos
            : internal.memberships.internal.updateMembershipFromWorkos;

        await ctx.runMutation(mutation, mapWorkosMembershipToSyncArgs(membership));
        break;
      }

      case "organization_membership.deleted": {
        const membership = data as unknown as WorkOSMembershipPayload;
        await ctx.runMutation(
          internal.memberships.internal.removeMembership,
          mapWorkosMembershipToRemoveArgs(membership),
        );
        break;
      }

      default:
        console.info("[WorkOS webhook] Unhandled event", { eventId, event });
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("[WorkOS webhook] processing error", { eventId, event, err });
    return new Response("Processing error", { status: 500 });
  }
});
