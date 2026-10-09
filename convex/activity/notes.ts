// What changed on an item, and who changed it (#656). The user action wrappers write a row
// for each change an entry declares (`activity` in ../lib/userActions.ts), whether a person
// made it or the assistant did for them; an item's Activity lists them newest first.

import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { DETAIL_MAX, itemKey, noteValidator, type Note } from "./validators";

/** Writes the rows for what a change did, as `by` in `workspaceId`. */
export async function noteActivity(ctx: Pick<MutationCtx, "db">, who: { workspaceId: Id<"workspaces">; by: Id<"users">; viaAssistant: boolean }, notes: Note | Note[] | null | undefined) {
  for (const note of [notes ?? []].flat()) {
    await ctx.db.insert("activity", {
      workspaceId: who.workspaceId,
      item: itemKey(note.kind, note.id),
      by: who.by,
      happened: note.happened,
      ...(note.count === undefined ? {} : { count: note.count }),
      ...(note.detail ? { detail: note.detail.slice(0, DETAIL_MAX) } : {}),
      ...(who.viaAssistant ? { viaAssistant: true as const } : {}),
    });
  }
}

/** The same, for a change an action made through its own mutations. */
export const write = internalMutation({
  args: { workspaceId: v.id("workspaces"), by: v.id("users"), viaAssistant: v.boolean(), notes: v.array(noteValidator) },
  returns: v.null(),
  handler: async (ctx, { notes, ...who }) => {
    await noteActivity(ctx, who, notes);
    return null;
  },
});
