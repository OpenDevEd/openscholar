/**
 * A screening's files sent by email to a colleague (OpenDevEd/openscholar#1546): the files are built in the browser as
 * their download is, so what is hidden from the sender is hidden in them, kept for a moment, and mailed with a link to
 * the screening. The sending itself needs Node (./filesMail.ts).
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { createError } from "../lib/errors";
import { internalMutation } from "../lib/functions";
import { rateLimit } from "../lib/rateLimit";
import { workspaceMutation } from "../lib/userActions";
import { standingOn } from "./access";
import { nameOf } from "./dealing";
import { screeningPath } from "../../lib/screening/links";

/** Files one email carries at most, how large they may be together, and how long a note may be. */
const FILES_MAX = 6;
const BYTES_MAX = 15 * 1024 * 1024;
const NOTE_MAX = 2_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const sendFiles = workspaceMutation({
  args: { jobId: v.id("screeningJobs"), to: v.string(), note: v.optional(v.string()), files: v.array(v.object({ name: v.string(), type: v.string(), file: v.id("_storage") })) },
  returns: v.null(),
  // An email goes to someone outside the app.
  handler: async (ctx, actor, { jobId, to, note, files }) => {
    const standing = await standingOn(ctx, actor, jobId);
    if (!standing) throw createError("SCREENING_JOB_NOT_FOUND", "Screening not found");
    const address = to.trim().toLowerCase();
    if (!EMAIL.test(address)) throw createError("VALIDATION_ERROR", "Type an email address to send the files to.");
    if (!files.length || files.length > FILES_MAX) throw createError("VALIDATION_ERROR", `Send 1 to ${FILES_MAX} files at a time.`);
    if ((note?.length ?? 0) > NOTE_MAX) throw createError("VALIDATION_ERROR", "That note is too long.");
    const sizes = await Promise.all(files.map(async (one) => (await ctx.db.system.get("_storage", one.file))?.size));
    if (sizes.some((size) => size === undefined)) throw createError("VALIDATION_ERROR", "A file didn't arrive. Send them again.");
    if (sizes.reduce<number>((sum, size) => sum + (size ?? 0), 0) > BYTES_MAX) throw createError("VALIDATION_ERROR", "These files are too large for one email. Send fewer, or download them.");
    // A few emails a day from one person: files go to someone outside the app under Openscholar's name.
    const { ok } = await rateLimit(ctx, { name: "screening-files", key: actor.userId });
    if (!ok) throw createError("CONFLICT", "You've sent a lot of files today. Try again tomorrow, or download them.");
    const [user, workspace] = await Promise.all([ctx.db.get("users", actor.userId), ctx.db.get("workspaces", standing.job.workspaceId)]);
    const organization = workspace?.kind === "organization" ? await ctx.db.get("organizations", workspace.organizationId) : null;
    await ctx.scheduler.runAfter(0, internal.screening.filesMail.send, {
      to: address,
      by: nameOf(user),
      ...(user?.email ? { replyTo: user.email } : {}),
      name: standing.job.name ?? "Screening",
      path: `${organization ? `/o/${organization.slug}` : ""}${screeningPath(jobId)}`,
      files: files.map((one) => ({ name: one.name.slice(0, 200), type: one.type.slice(0, 100), file: one.file })),
      ...(note?.trim() ? { note: note.trim() } : {}),
    });
    return null;
  },
});

/** The files of an email that went, or couldn't: kept no longer than it takes to send them. */
export const dropFiles = internalMutation({
  args: { files: v.array(v.id("_storage")) },
  returns: v.null(),
  handler: async (ctx, { files }) => {
    for (const file of files) await ctx.storage.delete(file);
    return null;
  },
});
