/**
 * Hand-offs (plans/evidence-library-sources): records, a search or a collection a library sends a reader to
 * OpenScholar with, and the questions their Smart screening asked. One lives seven days and holds no permission:
 * OpenScholar reads its source as whoever opens it, and the library becomes one they read.
 */
import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation } from "../lib/functions";
import { assistantAction, defineUserAction, userAction } from "../lib/userActions";
import { described, describedValidator } from "./library";
import { credentialedLibrary, noteReader } from "./readers";
import { evidenceLibraryHandoffFields, handoffFromValidator, handoffRecordsValidator } from "./validators";

const HANDOFF_MS = 7 * 24 * 60 * 60 * 1000;
const { libraryId: _library, expiresAt: _expires, ...handed } = evidenceLibraryHandoffFields;

/** A library's hand-off, made with its machine credential (./serviceHttp.ts `handOff`). */
export const create = internalMutation({
  args: { libraryId: v.string(), credentialDigest: v.string(), ...handed },
  returns: v.object({ handoffId: v.id("evidenceLibraryHandoffs"), expiresAt: v.number() }),
  handler: async (ctx, { libraryId, credentialDigest, ...handoff }) => {
    const library = await credentialedLibrary(ctx, libraryId, credentialDigest);
    const expiresAt = Date.now() + HANDOFF_MS;
    const handoffId = await ctx.db.insert("evidenceLibraryHandoffs", { libraryId: library, ...handoff, expiresAt });
    await ctx.scheduler.runAt(expiresAt, internal.evidenceLibraries.handoffs.expire, { handoffId });
    return { handoffId, expiresAt };
  },
});

export const expire = internalMutation({
  args: { handoffId: v.id("evidenceLibraryHandoffs") },
  returns: v.null(),
  handler: async (ctx, { handoffId }) => {
    if (await ctx.db.get("evidenceLibraryHandoffs", handoffId)) await ctx.db.delete("evidenceLibraryHandoffs", handoffId);
    return null;
  },
});

/** A hand-off not yet expired; opened by the person, its library is noted as one they read. */
export const opened = internalMutation({
  args: { handoffId: v.string(), userId: v.id("users"), note: v.boolean() },
  returns: v.union(v.null(), v.object({ libraryId: v.id("evidenceLibraries"), ...handed })),
  handler: async (ctx, { handoffId, userId, note }) => {
    const id = ctx.db.normalizeId("evidenceLibraryHandoffs", handoffId);
    const handoff = id ? await ctx.db.get("evidenceLibraryHandoffs", id) : null;
    if (!handoff || handoff.expiresAt <= Date.now()) return null;
    if (note) await noteReader(ctx, handoff.libraryId, userId, "handoff");
    return { libraryId: handoff.libraryId, from: handoff.from, source: handoff.source, fields: handoff.fields };
  },
});

const openedValidator = v.union(
  v.object({ gone: v.literal(true) }),
  v.object({
    from: handoffFromValidator,
    fields: evidenceLibraryHandoffFields.fields,
    found: describedValidator,
    /** The records it named, when asked for and it named them one by one; `unread` when the library couldn't list them. */
    records: v.union(handoffRecordsValidator, v.null(), v.literal("unread")),
  }),
);

export const openAction = defineUserAction({
  path: "evidenceLibraries/handoffs:open",
  description:
    "A hand-off a library made, as the person opening it may read its source, with the questions it brought; `gone` once it has expired. " +
    "With `records`, a hand-off of records lists them (title, authors, year). The assistant reading it doesn't add the library to the person's list; the person opening its link does.",
  args: { handoffId: v.string(), records: v.optional(v.boolean()) },
  returns: openedValidator,
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  run: async (ctx, { userId, author }, { handoffId, records: listing }): Promise<Infer<typeof openedValidator>> => {
    const handoff: Omit<Doc<"evidenceLibraryHandoffs">, "_id" | "_creationTime" | "expiresAt"> | null = await ctx.runMutation(internal.evidenceLibraries.handoffs.opened, { handoffId, userId, note: author === "user" });
    if (!handoff) return { gone: true };
    const found = await described(ctx, userId, handoff.libraryId, handoff.source);
    // A list the library couldn't give is said so, and leaves the hand-off to screen or extract from (the failure is logged where it's read).
    const records = listing && "row" in found && "records" in handoff.source ? await ctx.runAction(internal.evidenceLibraries.sourceActions.listed, { libraryId: handoff.libraryId, userId, keys: handoff.source.records }).catch(() => "unread" as const) : null;
    return { from: handoff.from, fields: handoff.fields, found, records };
  },
});
export const open = userAction(openAction);
export const openForAssistant = assistantAction(openAction);
