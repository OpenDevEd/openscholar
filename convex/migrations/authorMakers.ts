import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "../_generated/api";
import type { DataModel, Doc } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../lib/functions";
import { grantOf } from "../sharing/items";
import { actorIn } from "../workspaces/actor";

const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

/**
 * Until #1093 a profile's maker owned it while they could act in its workspace. Its owners are the workspace's now,
 * so a maker who still acts in it but doesn't run it edits it instead, as a maker does from now on. Safe to repeat.
 */
export async function keepMakerEditing(ctx: MutationCtx, profile: Doc<"authorProfiles">) {
  if (!profile.workspaceId || !profile.createdBy) return;
  const maker = await ctx.db.get("users", profile.createdBy);
  const actor = maker?.state === "active" ? await actorIn(ctx, maker, profile.workspaceId) : null;
  if (!maker || !actor || actor.role === "admin" || (await grantOf(ctx, profile._id, maker._id))) return;
  await ctx.db.insert("itemAccess", { kind: "author", item: profile._id, name: profile.name, userId: maker._id, role: "editor", grantedBy: maker._id, grantedAt: Date.now() });
}

export const makersEdit = migrations.define({ table: "authorProfiles", migrateOne: (ctx, profile) => keepMakerEditing(ctx, profile) });

export const run = migrations.runner([internal.migrations.authorMakers.makersEdit]);
