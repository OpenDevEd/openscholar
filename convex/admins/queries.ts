import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { stream } from "convex-helpers/server/stream";
import type { Doc } from "../_generated/dataModel";
import { query } from "../_generated/server";
import schema from "../schema";
import { getCurrentUser } from "../lib/auth";
import { ADMIN_LIST, countOf } from "../lib/listCounts";
import { assistantQuery, defineUserQuery, userQuery } from "../lib/userActions";
import { isAdmin, normalizeEmail, requireAdmin, requireAdminUser } from "./access";

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

/** Most rows one page of admins or candidates holds, and the rows one read of it takes. */
const PAGE_MAX = 50;
const ROWS_READ = 1_000;

/** A person's name and picture, as far as they have them. */
function shown(user: Doc<"users"> | null) {
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ");
  return { ...(name ? { name } : {}), ...(user?.avatarUrl ? { imageUrl: user.avatarUrl } : {}) };
}

export const listAdminsAction = defineUserQuery({
  path: "admins/queries:listAdmins",
  description:
    "Lists the admins and the people invited to be one, by email, a page at a time. Admins only. Given `search`, only those whose name or email contains it.",
  args: { paginationOpts: paginationOptsValidator, search: v.optional(v.string()) },
  returns: paginationResultValidator(adminRowValidator),
  run: async (ctx, userId, { paginationOpts, search }) => {
    await requireAdminUser(ctx, userId);
    const needle = search?.trim().toLowerCase();
    const rows = stream(ctx.db, schema)
      .query("admins")
      .withIndex("by_email")
      .map(async (row) => {
        const user = row.userId ? await ctx.db.get("users", row.userId) : null;
        return { _id: row._id, email: user?.email ?? row.email, ...shown(user), joined: user !== null, you: row.userId === userId, ...(row.delivery ? { delivery: row.delivery } : {}) };
      });
    return await (needle ? rows.filterWith(async (row) => `${row.name ?? ""} ${row.email}`.toLowerCase().includes(needle)) : rows).paginate({
      ...paginationOpts,
      numItems: Math.min(paginationOpts.numItems, PAGE_MAX),
      maximumRowsRead: ROWS_READ,
    });
  },
});
export const listAdmins = userQuery(listAdminsAction);
export const listAdminsForAssistant = assistantQuery(listAdminsAction);

export const countAdminsAction = defineUserQuery({
  path: "admins/queries:countAdmins",
  description: "Says how many admins there are, invited people included. Admins only.",
  args: {},
  returns: v.number(),
  run: async (ctx, userId) => {
    await requireAdminUser(ctx, userId);
    return await countOf(ctx, ADMIN_LIST);
  },
});
export const countAdmins = userQuery(countAdminsAction);
export const countAdminsForAssistant = assistantQuery(countAdminsAction);

export const listCandidatesAction = defineUserQuery({
  path: "admins/queries:listCandidates",
  description:
    "Lists the active users who aren't admins, by email, a page at a time, for adding one as an admin. Admins only. Given `search`, only those whose email starts with it.",
  args: { paginationOpts: paginationOptsValidator, search: v.string() },
  returns: paginationResultValidator(v.object({ _id: v.id("users"), email: v.string(), name: v.optional(v.string()), imageUrl: v.optional(v.string()) })),
  run: async (ctx, userId, { paginationOpts, search }) => {
    await requireAdminUser(ctx, userId);
    const prefix = normalizeEmail(search);
    // Through the index of active users by email, so a page fills however many accounts were deleted.
    // ponytail: admins are passed over as they're read, so a run of ROWS_READ admins in a row by email
    // returns an empty page the picker can't scroll past. An index of non-admin users would lift it.
    return await stream(ctx.db, schema)
      .query("users")
      .withIndex("by_state_and_email", (q) => (prefix ? q.eq("state", "active").gte("email", prefix).lt("email", `${prefix}\uffff`) : q.eq("state", "active")))
      .filterWith(async (user) => !(await isAdmin(ctx, user._id)))
      .map(async (user) => ({ _id: user._id, email: user.email, ...shown(user) }))
      .paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, PAGE_MAX), maximumRowsRead: ROWS_READ });
  },
});
export const listCandidates = userQuery(listCandidatesAction);
export const listCandidatesForAssistant = assistantQuery(listCandidatesAction);

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
