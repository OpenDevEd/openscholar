import { v } from "convex/values";
import { query } from "../_generated/server";
import { getCurrentUser } from "../lib/auth";
import { isAdmin, normalizeEmail, requireAdmin } from "./access";

/** Admins are a handful of people; the list is read whole. */
const MAX_ADMINS = 500;

/** Whether the signed-in user is an admin. Drives the Admin group in settings. */
export const amI = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    return user ? await isAdmin(ctx, user._id) : false;
  },
});

const adminRowValidator = v.object({
  _id: v.id("admins"),
  email: v.string(),
  name: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  /** False until someone signs up with the email. */
  joined: v.boolean(),
  you: v.boolean(),
  delivery: v.optional(v.union(v.literal("sent"), v.literal("failed"))),
});

export const list = query({
  args: {},
  returns: v.array(adminRowValidator),
  handler: async (ctx) => {
    const me = await requireAdmin(ctx);
    const rows = await ctx.db.query("admins").take(MAX_ADMINS);
    const out = await Promise.all(
      rows.map(async (row) => {
        const user = row.userId ? await ctx.db.get("users", row.userId) : null;
        const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ");
        return {
          _id: row._id,
          email: user?.email ?? row.email,
          ...(name ? { name } : {}),
          ...(user?.avatarUrl ? { imageUrl: user.avatarUrl } : {}),
          joined: user !== null,
          you: row.userId === me._id,
          ...(row.delivery ? { delivery: row.delivery } : {}),
        };
      }),
    );
    // You first, then people who have joined, then invites; each by email.
    return out.sort(
      (a, b) => Number(b.you) - Number(a.you) || Number(b.joined) - Number(a.joined) || a.email.localeCompare(b.email),
    );
  },
});

/** Users whose email starts with `search`, for adding an existing user as an admin. */
export const candidates = query({
  args: { search: v.string() },
  returns: v.array(
    v.object({ _id: v.id("users"), email: v.string(), name: v.optional(v.string()), imageUrl: v.optional(v.string()) }),
  ),
  handler: async (ctx, { search }) => {
    await requireAdmin(ctx);
    const prefix = normalizeEmail(search);
    const users = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => (prefix ? q.gte("email", prefix).lt("email", `${prefix}￿`) : q))
      .take(20);
    const out = [];
    for (const user of users) {
      if (user.state !== "active" || (await isAdmin(ctx, user._id))) continue;
      const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
      out.push({
        _id: user._id,
        email: user.email,
        ...(name ? { name } : {}),
        ...(user.avatarUrl ? { imageUrl: user.avatarUrl } : {}),
      });
    }
    return out;
  },
});

/** Where the admin rail's external dashboards live, from the deployment's settings. */
export const links = query({
  args: {},
  returns: v.object({ autumn: v.optional(v.string()) }),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const autumn = process.env.AUTUMN_DASHBOARD_URL;
    return autumn ? { autumn } : {};
  },
});
