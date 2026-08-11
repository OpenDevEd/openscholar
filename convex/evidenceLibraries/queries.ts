import { query, type QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { createError } from "../lib/errors";
import { requireEvidenceLibraryAccess } from "./access";
import {
  configProvenanceValidator,
  evidenceLibraryFields,
  sectionKeyValidator,
} from "./validators";

export async function readEvidenceLibraryDraft(
  ctx: QueryCtx,
  args: { libraryId: Id<"evidenceLibraries"> },
) {
  const access = await requireEvidenceLibraryAccess(ctx, args.libraryId, "read");
  const draft = await ctx.db
    .query("evidenceLibraryConfigDrafts")
    .withIndex("by_libraryId", (query) => query.eq("libraryId", args.libraryId))
    .unique();
  if (!draft) {
    throw createError("NOT_FOUND", "Evidence Library draft not found");
  }
  const sectionRows = await ctx.db
    .query("evidenceLibraryConfigSections")
    .withIndex("by_draftId_and_sectionKey", (query) =>
      query.eq("draftId", draft._id),
    )
    .collect();
  const sections = sectionRows.map((section) => {
    if (section.kind !== "draft") {
      throw new Error("Draft section index returned a revision row");
    }
    return {
      contractProvenance: section.contractProvenance,
      payload: section.payload,
      payloadByteLength: section.payloadByteLength,
      sectionKey: section.sectionKey,
      updatedAt: section.updatedAt,
    };
  });
  return { draft, library: access.library, sections };
}

export const getDraft = query({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.object({
    library: v.object({
      _id: v.id("evidenceLibraries"),
      _creationTime: v.number(),
      ...evidenceLibraryFields,
    }),
    draft: v.object({
      _id: v.id("evidenceLibraryConfigDrafts"),
      _creationTime: v.number(),
      libraryId: v.id("evidenceLibraries"),
      baseRevisionId: v.union(v.id("evidenceLibraryConfigRevisions"), v.null()),
      editVersion: v.number(),
      contractProvenance: configProvenanceValidator,
      createdByClerkUserId: v.string(),
      updatedByClerkUserId: v.string(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    sections: v.array(
      v.object({
        sectionKey: sectionKeyValidator,
        payload: v.any(),
        payloadByteLength: v.number(),
        contractProvenance: configProvenanceValidator,
        updatedAt: v.number(),
      }),
    ),
  }),
  handler: readEvidenceLibraryDraft,
});
