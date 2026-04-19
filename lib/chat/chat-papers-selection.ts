/**
 * Pure optimistic-patch helpers for the chat Sources panel.
 *
 * Shared by both the single-toggle `toggleChatPaper` mutation's
 * `.withOptimisticUpdate` callback and the bulk `bulkSetChatPapers`
 * mutation's callback. Kept pure so they can be exhaustively tested
 * without a Convex harness — the Convex wrappers just adapt the
 * localStore in and out.
 */

import type { Id } from "@/convex/_generated/dataModel";

export type InclusionLike = {
  chatPaperId: Id<"chatPapers">;
  sourceId: Id<"extractionJobSources">;
  included: boolean;
};

export function applyInclusionPatch<R extends InclusionLike>(
  rows: ReadonlyArray<R>,
  patch: ReadonlyMap<Id<"chatPapers">, boolean>,
): R[] {
  return rows.map((row) => {
    const next = patch.get(row.chatPaperId);
    return next === undefined ? row : { ...row, included: next };
  });
}

export function buildBulkPatch<R extends InclusionLike>(
  rows: ReadonlyArray<R>,
  sourceIds: ReadonlyArray<Id<"extractionJobSources">> | undefined,
  included: boolean,
): Map<Id<"chatPapers">, boolean> {
  const target = sourceIds === undefined ? null : new Set(sourceIds);
  const patch = new Map<Id<"chatPapers">, boolean>();
  for (const row of rows) {
    if (target !== null && !target.has(row.sourceId)) continue;
    if (row.included !== included) {
      patch.set(row.chatPaperId, included);
    }
  }
  return patch;
}
