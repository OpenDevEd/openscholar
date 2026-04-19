/**
 * Chat-surface authorization helpers.
 *
 * Two entry points, one for each handle the client may hold:
 *
 * - `authorizeThreadAccess(ctx, threadId)` — resolve the opaque agent
 *   threadId back to the owning extractionJobs row and verify the
 *   caller owns it. Used by every public mutation/query whose arg is
 *   `threadId: v.string()`.
 * - `assertCallerOwnsJob(ctx, jobId)` — direct jobId ownership check
 *   for surfaces that already know the jobId (e.g. the chatPapers
 *   toggle mutations, whose optimistic-update path has the jobId in
 *   hand and would pay a second round trip to re-derive it from the
 *   thread).
 *
 * Both helpers rely on `requireAuth` from `../lib/auth` to resolve
 * the Clerk identity → `users` row and throw the same error codes
 * used by the rest of the chat surface: `FORBIDDEN` when the job
 * exists but belongs to someone else or is not a chat job,
 * `UNAUTHENTICATED` when `requireAuth` throws because the identity
 * is missing, and `NOT_FOUND` when the job row itself is missing.
 */

import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";

export async function authorizeThreadAccess(
  ctx: QueryCtx | MutationCtx,
  threadId: string,
): Promise<{ job: Doc<"extractionJobs">; user: Doc<"users"> }> {
  const user = await requireAuth(ctx);
  const job = await ctx.db
    .query("extractionJobs")
    .withIndex("by_chatThread", (q) => q.eq("chatThreadId", threadId))
    .unique();
  if (!job || job.userId !== user._id || job.mode !== "chat") {
    throw createError("FORBIDDEN", "Access denied");
  }
  return { job, user };
}
