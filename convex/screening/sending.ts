/**
 * A screening's files sent by email to a colleague (OpenDevEd/openscholar#1546). The files are built in the browser as
 * their download is, so what is hidden from the sender is hidden in them, and come here as they are: no stored file is
 * named, so nothing but what the sender built can be sent. The sending itself needs Node (./filesMail.ts).
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { createError } from "../lib/errors";
import { internalMutation, internalQuery } from "../lib/functions";
import { rateLimit } from "../lib/rateLimit";
import { workspaceAction } from "../lib/userActions";
import { standingOn } from "./access";
import { nameOf } from "./dealing";
import { screeningPath } from "../../lib/screening/links";

/** Files one email carries at most, how large they may be together, and how long a note may be. The files go to a Node action whole, and its arguments take 5 MiB at most: 4 MiB of files leaves room for the rest. */
const FILES_MAX = 6;
const BYTES_MAX = 4 * 1024 * 1024;
const NOTE_MAX = 2_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const fileValidator = v.object({ name: v.string(), type: v.string(), body: v.string(), base64: v.optional(v.boolean()) });
/** The files Export makes, by their ending: nothing else goes out under Openscholar's name. Only a PNG comes as bytes, in base64. */
const KINDS: Record<string, string> = { csv: "text/csv", bib: "application/x-bibtex", ris: "application/x-research-info-systems", json: "application/json", svg: "image/svg+xml", png: "image/png", txt: "text/plain" };
const exported = (one: { name: string; type: string; base64?: boolean }) => { const ending = one.name.split(".").pop()?.toLowerCase() ?? ""; return KINDS[ending] === one.type && Boolean(one.base64) === (ending === "png"); };

export const sendFiles = workspaceAction({
  args: { jobId: v.id("screeningJobs"), to: v.string(), note: v.optional(v.string()), files: v.array(fileValidator) },
  returns: v.null(),
  // An email goes to someone outside the app.
  handler: async (ctx, actor, { jobId, to, note, files }): Promise<null> => {
    const address = to.trim().toLowerCase();
    if (!EMAIL.test(address)) throw createError("VALIDATION_ERROR", "Type an email address to send the files to.");
    if (!files.length || files.length > FILES_MAX) throw createError("VALIDATION_ERROR", `Send 1 to ${FILES_MAX} files at a time.`);
    if (!files.every(exported)) throw createError("VALIDATION_ERROR", "Only Export's own files can be sent.");
    if ((note?.length ?? 0) > NOTE_MAX) throw createError("VALIDATION_ERROR", "That note is too long.");
    if (new TextEncoder().encode(JSON.stringify(files)).length > BYTES_MAX) throw createError("VALIDATION_ERROR", "These files are too large for one email. Send fewer, or download them.");
    const about: { name: string; path: string; by: string; replyTo?: string } = await ctx.runQuery(internal.screening.sending.about, { jobId, userId: actor.userId, workspaceId: actor.workspaceId });
    await ctx.runMutation(internal.screening.sending.spend, { userId: actor.userId });
    await ctx.runAction(internal.screening.filesMail.send, { ...about, to: address, files: files.map((one) => ({ name: one.name.slice(0, 200), type: one.type, body: one.body, ...(one.base64 ? { base64: true } : {}) })), ...(note?.trim() ? { note: note.trim() } : {}) });
    return null;
  },
});

/** The screening as the email names it, for someone who may read it. */
export const about = internalQuery({
  args: { jobId: v.id("screeningJobs"), userId: v.id("users"), workspaceId: v.id("workspaces") },
  returns: v.object({ name: v.string(), path: v.string(), by: v.string(), replyTo: v.optional(v.string()) }),
  handler: async (ctx, { jobId, ...actor }) => {
    const standing = await standingOn(ctx, actor, jobId);
    if (!standing) throw createError("SCREENING_JOB_NOT_FOUND", "Screening not found");
    const [user, workspace] = await Promise.all([ctx.db.get("users", actor.userId), ctx.db.get("workspaces", standing.job.workspaceId)]);
    const organization = workspace?.kind === "organization" ? await ctx.db.get("organizations", workspace.organizationId) : null;
    return { name: standing.job.name ?? "Screening", path: `${organization ? `/o/${organization.slug}` : ""}${screeningPath(jobId)}`, by: nameOf(user), ...(user?.email ? { replyTo: user.email } : {}) };
  },
});

/** A few emails a day from one person: files go to someone outside the app under Openscholar's name. */
export const spend = internalMutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const { ok } = await rateLimit(ctx, { name: "screening-files", key: userId });
    if (!ok) throw createError("CONFLICT", "You've sent a lot of files today. Try again tomorrow, or download them.");
    return null;
  },
});
