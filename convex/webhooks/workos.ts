import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";

type WorkOSUser = {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  profile_picture_url?: string;
};

type WorkOSOrg = {
  id: string;
  name: string;
};

type WorkOSMembership = {
  user_id: string;
  organization_id: string;
  role: { slug: string };
};

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

  const { event, data } = result;

  try {
    switch (event) {
      // ── User Events ──────────────────────────────────────────────
      case "user.created":
      case "user.updated": {
        const user = data as unknown as WorkOSUser;
        const mutation =
          event === "user.created"
            ? internal.users.internal.syncUserFromWorkos
            : internal.users.internal.updateUserFromWorkos;

        await ctx.runMutation(mutation, {
          workosId: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          avatarUrl: user.profile_picture_url,
        });
        break;
      }

      case "user.deleted": {
        const user = data as unknown as WorkOSUser;
        await ctx.runMutation(internal.users.internal.markUserDeleted, {
          workosId: user.id,
        });
        break;
      }

      // ── Organization Events ──────────────────────────────────────
      case "organization.created":
      case "organization.updated": {
        const org = data as unknown as WorkOSOrg;
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

      // ── Membership Events ────────────────────────────────────────
      case "organization_membership.created":
      case "organization_membership.updated": {
        const membership = data as unknown as WorkOSMembership;
        const mutation =
          event === "organization_membership.created"
            ? internal.memberships.internal.syncMembershipFromWorkos
            : internal.memberships.internal.updateMembershipFromWorkos;

        await ctx.runMutation(mutation, {
          userWorkosId: membership.user_id,
          orgWorkosId: membership.organization_id,
          role: mapWorkosRole(membership.role?.slug),
        });
        break;
      }

      case "organization_membership.deleted": {
        const membership = data as unknown as WorkOSMembership;
        await ctx.runMutation(internal.memberships.internal.removeMembership, {
          userWorkosId: membership.user_id,
          orgWorkosId: membership.organization_id,
        });
        break;
      }

      default:
        console.log(`Unhandled WorkOS event: ${event}`);
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("WorkOS webhook processing error:", err);
    return new Response("Processing error", { status: 500 });
  }
});

function mapWorkosRole(slug?: string): "owner" | "admin" | "member" {
  if (slug === "owner" || slug === "org:owner") return "owner";
  if (slug === "admin" || slug === "org:admin") return "admin";
  return "member";
}
