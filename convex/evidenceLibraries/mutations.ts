import { mutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { EVIDENCE_LIBRARY_CONFIG_PROVENANCE } from "../../lib/evidence-libraries/configuration/contract";
import { createError } from "../lib/errors";
import {
  requireEvidenceLibraryAccess,
  requireOrganizationAccess,
} from "./access";
import { nextDraftEditVersion } from "./draftVersion";
import {
  assertDraftPayloadBudget,
  validateSectionPayload,
} from "./sectionPayload";
import { sectionKeyValidator, type SectionKey } from "./validators";

export async function createEvidenceLibrary(
  ctx: MutationCtx,
  args: { name: string; slug: string },
) {
  const access = await requireOrganizationAccess(ctx, "manage");
  const name = args.name.trim();
  const slug = args.slug.trim();
  if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw createError("VALIDATION_ERROR", "Invalid Evidence Library name or slug");
  }
  const existing = await ctx.db
    .query("evidenceLibraries")
    .withIndex("by_organizationId_and_slug", (query) =>
      query.eq("organizationId", access.organization._id).eq("slug", slug),
    )
    .unique();
  if (existing) {
    throw createError("CONFLICT", "Evidence Library slug already exists");
  }

  const now = Date.now();
  const libraryId = await ctx.db.insert("evidenceLibraries", {
    organizationId: access.organization._id,
    name,
    slug,
    state: "provisioning",
    createdByClerkUserId: access.clerkUserId,
    updatedByClerkUserId: access.clerkUserId,
    createdAt: now,
    updatedAt: now,
  });
  const draftId = await ctx.db.insert("evidenceLibraryConfigDrafts", {
    libraryId,
    baseRevisionId: null,
    editVersion: 0,
    contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
    createdByClerkUserId: access.clerkUserId,
    updatedByClerkUserId: access.clerkUserId,
    createdAt: now,
    updatedAt: now,
  });
  return { draftId, editVersion: 0, libraryId };
}

export async function saveEvidenceLibraryDraftSection(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    sectionKey: SectionKey;
    payload: unknown;
    expectedEditVersion: number;
  },
) {
  const access = await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
  const draft = await ctx.db
    .query("evidenceLibraryConfigDrafts")
    .withIndex("by_libraryId", (query) => query.eq("libraryId", args.libraryId))
    .unique();
  if (!draft) {
    throw createError("NOT_FOUND", "Evidence Library draft not found");
  }
  const editVersion = nextDraftEditVersion(
    draft.editVersion,
    args.expectedEditVersion,
  );
  const payloadByteLength = validateSectionPayload(args.payload);
  const sections = await ctx.db
    .query("evidenceLibraryConfigSections")
    .withIndex("by_draftId_and_sectionKey", (query) =>
      query.eq("draftId", draft._id),
    )
    .collect();
  const existing = sections.find((section) => section.sectionKey === args.sectionKey);
  const totalByteLength =
    sections.reduce((total, section) => total + section.payloadByteLength, 0) -
    (existing?.payloadByteLength ?? 0) +
    payloadByteLength;
  assertDraftPayloadBudget(totalByteLength);

  const now = Date.now();
  const sectionFields = {
    kind: "draft" as const,
    libraryId: args.libraryId,
    draftId: draft._id,
    sectionKey: args.sectionKey,
    payload: args.payload,
    payloadByteLength,
    contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
    updatedByClerkUserId: access.clerkUserId,
    updatedAt: now,
  };
  if (existing) {
    await ctx.db.replace("evidenceLibraryConfigSections", existing._id, sectionFields);
  } else {
    await ctx.db.insert("evidenceLibraryConfigSections", sectionFields);
  }
  await ctx.db.patch("evidenceLibraryConfigDrafts", draft._id, {
    editVersion,
    contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
    updatedByClerkUserId: access.clerkUserId,
    updatedAt: now,
  });
  return { editVersion, payloadByteLength };
}

export const createLibrary = mutation({
  args: { name: v.string(), slug: v.string() },
  returns: v.object({
    draftId: v.id("evidenceLibraryConfigDrafts"),
    editVersion: v.number(),
    libraryId: v.id("evidenceLibraries"),
  }),
  handler: createEvidenceLibrary,
});

export const saveDraftSection = mutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    sectionKey: sectionKeyValidator,
    payload: v.any(),
    expectedEditVersion: v.number(),
  },
  returns: v.object({
    editVersion: v.number(),
    payloadByteLength: v.number(),
  }),
  handler: saveEvidenceLibraryDraftSection,
});
