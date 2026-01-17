import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { api } from "../_generated/api";

export const workosWebhook = httpAction(async (ctx, req) => {
  const payloadText = await req.text();
  const sigHeader = req.headers.get("workos-signature");

  if (!sigHeader) {
    return new Response("Missing signature", { status: 401 });
  }

  // Verify signature using Node.js action
  const result = await ctx.runAction(api.webhooks.actions.verifyWorkosWebhook, {
    payloadText,
    signature: sigHeader,
  });

  if (!result.success) {
    console.error("WorkOS webhook verification failed:", result.error);
    return new Response("Invalid signature", { status: 401 });
  }

  const event = result.event;
  const data = result.data;

  try {
    switch (event) {
      // ── User Events ──────────────────────────────────────────────
      case "user.created":
        await ctx.runMutation(internal.users.internal.syncUserFromWorkos, {
          workosId: data.id as string,
          email: data.email as string,
          firstName: (data.first_name as string) ?? undefined,
          lastName: (data.last_name as string) ?? undefined,
          avatarUrl: (data.profile_picture_url as string) ?? undefined,
        });
        break;

      case "user.updated":
        await ctx.runMutation(internal.users.internal.updateUserFromWorkos, {
          workosId: data.id as string,
          email: data.email as string,
          firstName: (data.first_name as string) ?? undefined,
          lastName: (data.last_name as string) ?? undefined,
          avatarUrl: (data.profile_picture_url as string) ?? undefined,
        });
        break;

      case "user.deleted":
        await ctx.runMutation(internal.users.internal.markUserDeleted, {
          workosId: data.id as string,
        });
        break;

      // ── Organization Events ──────────────────────────────────────
      case "organization.created":
        await ctx.runMutation(internal.organizations.internal.syncOrgFromWorkos, {
          workosId: data.id as string,
          name: data.name as string,
        });
        break;

      case "organization.updated":
        await ctx.runMutation(internal.organizations.internal.updateOrgFromWorkos, {
          workosId: data.id as string,
          name: data.name as string,
        });
        break;

      // ── Membership Events ────────────────────────────────────────
      case "organization_membership.created":
        await ctx.runMutation(internal.memberships.internal.syncMembershipFromWorkos, {
          userWorkosId: data.user_id as string,
          orgWorkosId: data.organization_id as string,
          role: mapWorkosRole((data.role as { slug?: string })?.slug),
        });
        break;

      case "organization_membership.updated":
        await ctx.runMutation(internal.memberships.internal.updateMembershipFromWorkos, {
          userWorkosId: data.user_id as string,
          orgWorkosId: data.organization_id as string,
          role: mapWorkosRole((data.role as { slug?: string })?.slug),
        });
        break;

      case "organization_membership.deleted":
        await ctx.runMutation(internal.memberships.internal.removeMembership, {
          userWorkosId: data.user_id as string,
          orgWorkosId: data.organization_id as string,
        });
        break;

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
