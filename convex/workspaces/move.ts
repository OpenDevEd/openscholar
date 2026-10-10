// Moving an item to another of the person's workspaces (#654): a search with its screening
// answers and history, a finished screening or extraction job, or a chat they started. Its
// activity goes with it and records where it came from; the person goes with it too.

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "../lib/functions";
import { createError } from "../lib/errors";
import { personName } from "../lib/people";
import { assistantMutation, assistantQuery, defineUserMutation, defineUserQuery, userMutation, userQuery, type Acting } from "../lib/userActions";
import { findSearch } from "../research/records";
import { screeningFor } from "../research/answers";
import { noteActivity } from "../activity/notes";
import { itemKey } from "../activity/validators";
import { actorIn } from "./actor";

export const movableKinds = ["search", "screening", "extraction", "chat"] as const;
export type Movable = (typeof movableKinds)[number];

/** A job moves once it has finished: until then its credits are held by the workspace it runs in. */
const FINISHED = new Set(["completed", "cancelled", "failed"]);

/** Activity rows one step moves with their item. */
const ACTIVITY_STEP = 200;

/** A workspace as the person sees it named: an organization's name, or its person's for their own. */
export async function workspaceName(ctx: Pick<QueryCtx, "db">, workspaceId: Id<"workspaces">) {
  const workspace = await ctx.db.get("workspaces", workspaceId);
  if (!workspace) return "";
  if (workspace.kind === "organization") return (await ctx.db.get("organizations", workspace.organizationId))?.name ?? "";
  const person = await ctx.db.get("users", workspace.userId);
  return (person && (personName(person) || person.email)) || "";
}

/**
 * Why the item can't move, the first reason that holds, or null: only an organization's admins
 * move its work out of it (#654), and a job or a chat waits until it's done.
 */
export async function heldBack(ctx: Pick<QueryCtx, "db">, { workspaceId, role, userId }: Pick<Acting, "workspaceId" | "role" | "userId">, kind: Movable, id: string) {
  const workspace = await ctx.db.get("workspaces", workspaceId);
  if (workspace?.kind === "organization" && role !== "admin") return `Only ${await workspaceName(ctx, workspaceId)}'s admins move its work out of it.`;
  if (kind === "screening" || kind === "extraction") {
    const job = await jobIn(ctx, workspaceId, kind, id);
    if (!FINISHED.has(job.status ?? "")) return `A running ${kind === "screening" ? "screening" : "extraction"} moves once it has finished.`;
  }
  if (kind === "chat") {
    const thread = await chatIn(ctx, workspaceId, id);
    if (thread.createdBy !== userId) return "Only the person who started a chat moves it.";
    if (thread.reply) return "A chat moves once its reply has finished.";
  }
  return null;
}

async function jobIn(ctx: Pick<QueryCtx, "db">, workspaceId: Id<"workspaces">, kind: "screening" | "extraction", id: string) {
  const table = kind === "screening" ? "screeningJobs" : "extractionJobs";
  const jobId = ctx.db.normalizeId(table, id);
  const job = jobId ? await ctx.db.get(table, jobId) : null;
  if (job?.workspaceId !== workspaceId) throw createError("NOT_FOUND", kind === "screening" ? "Screening not found" : "Extraction not found");
  return job;
}

async function chatIn(ctx: Pick<QueryCtx, "db">, workspaceId: Id<"workspaces">, id: string) {
  const threadId = ctx.db.normalizeId("assistantThreads", id);
  const thread = threadId ? await ctx.db.get("assistantThreads", threadId) : null;
  if (thread?.workspaceId !== workspaceId) throw createError("NOT_FOUND", "Chat not found");
  return thread;
}

/** Puts the item, and what's stored with it by its workspace, in `to`. */
async function rehome(ctx: MutationCtx, from: Id<"workspaces">, to: Id<"workspaces">, kind: Movable, id: string) {
  if (kind === "search") {
    const search = await findSearch(ctx, from, id);
    if (!search) throw createError("NOT_FOUND", "Search not found");
    if (await findSearch(ctx, to, id)) throw createError("CONFLICT", "That workspace has this search already.");
    await ctx.db.patch("searches", search._id, { workspaceId: to });
    // Its screening answers are its own; the papers it saved stay in the library they went to.
    const screening = await screeningFor(ctx, search._id);
    if (screening) await ctx.db.patch("screenings", screening._id, { workspaceId: to });
  } else if (kind === "screening") {
    const job = await jobIn(ctx, from, kind, id);
    // The collection its papers went to stays where it is, with them.
    await ctx.db.patch("screeningJobs", job._id as Id<"screeningJobs">, { workspaceId: to, targetCollectionId: undefined });
  } else if (kind === "extraction") {
    const job = await jobIn(ctx, from, kind, id);
    await ctx.db.patch("extractionJobs", job._id as Id<"extractionJobs">, { workspaceId: to });
  } else {
    const thread = await chatIn(ctx, from, id);
    await ctx.db.patch("assistantThreads", thread._id, { workspaceId: to });
  }
}

/** Moves the rows of an item's activity to its new workspace, a step at a time. */
export const moveActivity = internalMutation({
  args: { from: v.id("workspaces"), to: v.id("workspaces"), item: v.string() },
  returns: v.null(),
  handler: async (ctx, { from, to, item }) => {
    const rows = await ctx.db.query("activity").withIndex("by_workspace_and_item", (q) => q.eq("workspaceId", from).eq("item", item)).take(ACTIVITY_STEP);
    for (const row of rows) await ctx.db.patch("activity", row._id, { workspaceId: to });
    if (rows.length === ACTIVITY_STEP) await ctx.scheduler.runAfter(0, internal.workspaces.move.moveActivity, { from, to, item });
    return null;
  },
});

const kindValidator = v.union(...movableKinds.map((kind) => v.literal(kind)));

/** Why an item of the workspace the person is in can't move yet, for its Move dialog; null when it can. */
export const heldAction = defineUserQuery({
  path: "workspaces/move:held",
  description: "Says why an item of the workspace the person is in can't move to another workspace yet, or null when it can.",
  args: { kind: kindValidator, id: v.string() },
  returns: v.union(v.string(), v.null()),
  run: (ctx, actor, { kind, id }) => heldBack(ctx, actor, kind, id),
});
export const held = userQuery(heldAction);
export const heldForAssistant = assistantQuery(heldAction);

export const moveAction = defineUserMutation({
  path: "workspaces/move:move",
  description:
    "Moves an item of the workspace the person is in to another workspace they belong to, and everyone in that workspace then sees it: a search (by its ID in the address) with its screening answers and earlier queries, a finished screening or extraction job, or a chat the person started. " +
    "Only an organization's admins move its work out of it; a running job, or a chat writing a reply, moves once it has finished. Its activity goes with it. Returns the workspace it went to.",
  args: { kind: kindValidator, id: v.string(), to: v.id("workspaces") },
  returns: v.object({ to: v.id("workspaces") }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: false,
  // Everyone in the workspace it goes to sees it from then on.
  asksFirst: async () => true,
  run: async (ctx, actor, { kind, id, to }) => {
    if (to === actor.workspaceId) throw createError("VALIDATION_ERROR", "It's in that workspace already.");
    const person = await ctx.db.get("users", actor.userId);
    if (!person || !(await actorIn(ctx, person, to))) throw createError("NOT_FOUND", "Workspace not found");
    const held = await heldBack(ctx, actor, kind, id);
    if (held) throw createError("VALIDATION_ERROR", held);
    await rehome(ctx, actor.workspaceId, to, kind, id);
    // Chats keep no activity.
    if (kind !== "chat") {
      await ctx.scheduler.runAfter(0, internal.workspaces.move.moveActivity, { from: actor.workspaceId, to, item: itemKey(kind, id) });
      await noteActivity(ctx, { workspaceId: to, by: actor.userId, viaAssistant: actor.author === "assistant" }, { kind, id, happened: "moved", detail: await workspaceName(ctx, actor.workspaceId) });
    }
    return { to };
  },
});
export const move = userMutation(moveAction);
export const moveForAssistant = assistantMutation(moveAction);
