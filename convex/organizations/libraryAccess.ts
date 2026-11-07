/**
 * Which workspaces can create Evidence Communities, which OpenScholar's admins switch on one at a time
 * (Settings, Evidence Communities): an organization's, for its admins, or a person's own. The switch
 * leaves the workspace's plan as it is, and only decides creating.
 */
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { stream } from "convex-helpers/server/stream";
import schema from "../schema";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { normalizeEmail } from "../admins/access";
import { ensureWorkspace } from "../workspaces/create";
import { TEAM_PLAN } from "../../lib/billing/plans";
import { internalMutation, mutation } from "../lib/functions";
import { requireAdmin, requireAdminUser } from "../admins/access";
import { createError } from "../lib/errors";
import { searchTerms } from "../lib/searchText";
import { assistantQuery, defineUserQuery, userQuery } from "../lib/userActions";
import { MAX_LIBRARIES_PER_WORKSPACE } from "../lib/queryBounds";
import { refuseApps } from "../lib/auth";

const showValidator = v.union(v.literal("all"), v.literal("on"), v.literal("off"));

/** Most rows one page holds. */
const PAGE_MAX = 50;
// ponytail: counted by reading rows, up to this many; a sharded count (lib/listCounts) once organizations pass it.
const COUNT_READ = 1_000;

const rowValidator = v.object({
  _id: v.id("organizations"),
  name: v.string(),
  imageUrl: v.optional(v.string()),
  on: v.boolean(),
  libraries: v.number(),
});

export const listAction = defineUserQuery({
  path: "organizations/libraryAccess:list",
  description:
    "Lists organizations by name, a page at a time, with whether Evidence Communities are on for each and how many communities it has. Admins only. `show` narrows it to those switched on or off; given `search`, those whose name best matches its words, best first.",
  args: { paginationOpts: paginationOptsValidator, show: v.optional(showValidator), search: v.optional(v.string()) },
  returns: paginationResultValidator(rowValidator),
  run: async (ctx, { userId }, { paginationOpts, show = "all", search }) => {
    await requireAdminUser(ctx, userId);
    const needle = searchTerms(search);
    const opts = { ...paginationOpts, numItems: Math.min(paginationOpts.numItems, PAGE_MAX) };
    const on = show === "on" ? true : undefined;
    const read = await (needle
      ? ctx.db
          .query("organizations")
          .withSearchIndex("search_name", (q) => {
            const active = q.search("name", needle).eq("state", "active");
            return show === "all" ? active : active.eq("evidenceLibraries", on);
          })
          .paginate(opts)
      : show === "all"
        ? ctx.db.query("organizations").withIndex("by_state_and_name", (q) => q.eq("state", "active")).paginate(opts)
        : ctx.db.query("organizations").withIndex("by_state_and_evidenceLibraries_and_name", (q) => q.eq("state", "active").eq("evidenceLibraries", on)).paginate(opts));
    const page = await Promise.all(
      read.page.map(async (organization) => {
        const workspace = await ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", organization._id)).unique();
        const libraries = workspace ? await ctx.db.query("evidenceLibraries").withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id)).take(MAX_LIBRARIES_PER_WORKSPACE) : [];
        return { _id: organization._id, name: organization.name, ...(organization.imageUrl ? { imageUrl: organization.imageUrl } : {}), on: organization.evidenceLibraries === true, libraries: libraries.length };
      }),
    );
    return { ...read, page };
  },
});
export const list = userQuery(listAction);
export const listForAssistant = assistantQuery(listAction);

export const countAction = defineUserQuery({
  path: "organizations/libraryAccess:count",
  description: `Says how many organizations there are, those with Evidence Communities switched on or off when \`show\` says so, up to ${COUNT_READ}. Admins only.`,
  args: { show: v.optional(showValidator) },
  returns: v.number(),
  run: async (ctx, { userId }, { show = "all" }) => {
    await requireAdminUser(ctx, userId);
    const rows = show === "all"
      ? ctx.db.query("organizations").withIndex("by_state_and_name", (q) => q.eq("state", "active"))
      : ctx.db.query("organizations").withIndex("by_state_and_evidenceLibraries_and_name", (q) => q.eq("state", "active").eq("evidenceLibraries", show === "on" ? true : undefined));
    return (await rows.take(COUNT_READ)).length;
  },
});
export const count = userQuery(countAction);
export const countForAssistant = assistantQuery(countAction);

/** Switches Evidence Communities on or off for an organization: whether its admins can create them. Off takes nothing away from the communities it has. */
export const set = mutation({
  args: { organizationId: v.id("organizations"), on: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { organizationId, on }) => {
    await refuseApps(ctx);
    await requireAdmin(ctx);
    const organization = await ctx.db.get("organizations", organizationId);
    if (!organization) throw createError("NOT_FOUND", "This organization is gone.");
    // Off is absent, so the index lists organizations that were never switched on with those switched off.
    await ctx.db.patch("organizations", organizationId, { evidenceLibraries: on ? true : undefined });
    return null;
  },
});

/** Switches libraries on for every organization its plan gives them to, so moving it off that plan takes nothing away. Run once, by hand; safe to run again. */
export const switchOnPlanHolders = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    let changed = 0;
    for (const account of await ctx.db.query("billingAccounts").withIndex("by_plan", (q) => q.eq("plan", TEAM_PLAN)).take(COUNT_READ)) {
      const workspace = await ctx.db.get("workspaces", account.workspaceId);
      const organization = workspace?.kind === "organization" ? await ctx.db.get("organizations", workspace.organizationId) : null;
      if (organization && organization.evidenceLibraries !== true) {
        await ctx.db.patch("organizations", organization._id, { evidenceLibraries: true });
        changed += 1;
      }
    }
    return changed;
  },
});

const personValidator = v.object({
  _id: v.id("users"),
  email: v.string(),
  name: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  on: v.boolean(),
  libraries: v.number(),
});

/** Rows a page of people reads at most, so a filter that skips many still answers. */
const PEOPLE_ROWS_READ = 500;

const personalWorkspaceOf = async (ctx: QueryCtx, userId: Id<"users">) => {
  const workspace = await ctx.db.query("workspaces").withIndex("by_userId", (q) => q.eq("userId", userId)).unique();
  return workspace?.kind === "personal" ? workspace : null;
};

async function personRow(ctx: QueryCtx, user: Doc<"users">) {
  const workspace = await personalWorkspaceOf(ctx, user._id);
  const libraries = workspace ? await ctx.db.query("evidenceLibraries").withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id)).take(MAX_LIBRARIES_PER_WORKSPACE) : [];
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return { _id: user._id, email: user.email, ...(name ? { name } : {}), ...(user.avatarUrl ? { imageUrl: user.avatarUrl } : {}), on: workspace?.evidenceLibraries === true, libraries: libraries.length };
}

export const listPeopleAction = defineUserQuery({
  path: "organizations/libraryAccess:listPeople",
  description:
    "Lists active people by email, a page at a time, with whether they can create Evidence Communities in their own workspace and how many communities it has. Admins only. `show` narrows it to those switched on or off; given `search`, those whose email starts with it.",
  args: { paginationOpts: paginationOptsValidator, show: v.optional(showValidator), search: v.optional(v.string()) },
  returns: paginationResultValidator(personValidator),
  run: async (ctx, { userId }, { paginationOpts, show = "all", search }) => {
    await requireAdminUser(ctx, userId);
    const prefix = normalizeEmail(search ?? "");
    const opts = { ...paginationOpts, numItems: Math.min(paginationOpts.numItems, PAGE_MAX), maximumRowsRead: PEOPLE_ROWS_READ };
    const matches = (user: Doc<"users"> | null): user is Doc<"users"> => user !== null && user.state === "active" && (!prefix || user.email.startsWith(prefix));
    if (show === "on") {
      return await stream(ctx.db, schema)
        .query("workspaces")
        .withIndex("by_evidenceLibraries", (q) => q.eq("evidenceLibraries", true))
        .map(async (workspace) => (workspace.kind === "personal" ? await ctx.db.get("users", workspace.userId) : null))
        .filterWith(async (user) => matches(user))
        .map(async (user) => await personRow(ctx, user!))
        .paginate(opts);
    }
    // Off is told by the person's workspace alone, so a person passed over costs one read, not their communities.
    return await stream(ctx.db, schema)
      .query("users")
      .withIndex("by_state_and_email", (q) => (prefix ? q.eq("state", "active").gte("email", prefix).lt("email", `${prefix}\uffff`) : q.eq("state", "active")))
      .filterWith(async (user) => show === "all" || (await personalWorkspaceOf(ctx, user._id))?.evidenceLibraries !== true)
      .map(async (user) => await personRow(ctx, user))
      .paginate(opts);
  },
});
export const listPeople = userQuery(listPeopleAction);
export const listPeopleForAssistant = assistantQuery(listPeopleAction);

export const countPeopleAction = defineUserQuery({
  path: "organizations/libraryAccess:countPeople",
  description: `Says how many active people there are, those who can create Evidence Communities in their own workspace or can't when \`show\` says so, up to ${COUNT_READ}. Admins only.`,
  args: { show: v.optional(showValidator) },
  returns: v.number(),
  run: async (ctx, { userId }, { show = "all" }) => {
    await requireAdminUser(ctx, userId);
    // ponytail: counted by reading rows, up to COUNT_READ; a sharded count (lib/listCounts) once people pass it.
    // The people the list shows: active accounts, as the list reads them.
    const switchedOn = await ctx.db.query("workspaces").withIndex("by_evidenceLibraries", (q) => q.eq("evidenceLibraries", true)).take(COUNT_READ);
    const owners = await Promise.all(switchedOn.map((workspace) => (workspace.kind === "personal" ? ctx.db.get("users", workspace.userId) : null)));
    const on = owners.filter((user) => user?.state === "active").length;
    if (show === "on") return on;
    const all = (await ctx.db.query("users").withIndex("by_state", (q) => q.eq("state", "active")).take(COUNT_READ)).length;
    return show === "all" ? all : Math.max(0, all - on);
  },
});
export const countPeople = userQuery(countPeopleAction);
export const countPeopleForAssistant = assistantQuery(countPeopleAction);

/** Switches Evidence Communities on or off for a person's own workspace: whether they can create them there. Off takes nothing away from the communities it has. */
export const setPerson = mutation({
  args: { userId: v.id("users"), on: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { userId, on }) => {
    await refuseApps(ctx);
    await requireAdmin(ctx);
    const user = await ctx.db.get("users", userId);
    if (!user || user.state !== "active") throw createError("NOT_FOUND", "This account is gone.");
    const workspaceId = await ensureWorkspace(ctx, { kind: "personal", userId });
    // Off is absent, so the index holds only those switched on.
    await ctx.db.patch("workspaces", workspaceId, { evidenceLibraries: on ? true : undefined });
    return null;
  },
});
