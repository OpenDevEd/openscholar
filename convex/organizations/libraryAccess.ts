/**
 * Which organizations have Evidence Libraries, which OpenScholar's admins switch on one at a time
 * (Settings, Evidence Libraries). The switch is the organization's and leaves its plan as it is.
 */
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
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

/** Switches Evidence Libraries on or off for an organization. Off is refused while it has a library, which would be left with nobody able to open it. */
export const set = mutation({
  args: { organizationId: v.id("organizations"), on: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { organizationId, on }) => {
    await refuseApps(ctx);
    await requireAdmin(ctx);
    const organization = await ctx.db.get("organizations", organizationId);
    if (!organization) throw createError("NOT_FOUND", "This organization is gone.");
    if (!on) {
      const workspace = await ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)).unique();
      const library = workspace && (await ctx.db.query("evidenceLibraries").withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id)).first());
      if (library) throw createError("VALIDATION_ERROR", `${library.name} is one of this organization's Evidence Communities. Move or delete its communities first.`);
    }
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
