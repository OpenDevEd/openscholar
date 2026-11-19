import { assertCredentialRoom } from "./credentials";
import type { Doc } from "../_generated/dataModel";
import { v } from "convex/values";
import {
  query,
  internalQuery,
  internalMutation,
  type QueryCtx,
  type MutationCtx,
} from "../lib/functions";
import type { Id } from "../_generated/dataModel";
import { requireEvidenceLibraryAccess } from "./access";
import { requireNoRunningOperation } from "./aiProviderKey";
import { createError } from "../lib/errors";
import { writeAuditLogRecord } from "../lib/audit";
import {
  EMPTY_PUBLICATION_SETTINGS,
  PUBLICATION_CREDENTIAL_KEY,
} from "../../lib/evidence-libraries/configuration/publication-settings";
import { keptCustomOf, keptCustomValidator, publicationSettingsValidator } from "./publicationValidators";
import {
  evidenceLibraryCredentialFields,
  type LibraryCredentialSource,
} from "./validators";
import { refuseApps } from "../lib/auth";

type ReadCtx = Pick<QueryCtx | MutationCtx, "db">;
export async function readPublicationProviderRecord(
  ctx: ReadCtx,
  libraryId: Id<"evidenceLibraries">,
) {
  return ctx.db
    .query("evidenceLibraryCredentials")
    .withIndex("by_libraryId_and_credentialKey", (q) =>
      q
        .eq("libraryId", libraryId)
        .eq("credentialKey", PUBLICATION_CREDENTIAL_KEY),
    )
    .unique();
}

export async function readPublicationProviderSource(
  ctx: ReadCtx,
  libraryId: Id<"evidenceLibraries">,
): Promise<LibraryCredentialSource> {
  const record = await readPublicationProviderRecord(ctx, libraryId);
  if (!record) return { present: false };
  if (!record.credentialDigest)
    throw createError(
      "INVALID_DATA",
      "Publishing credentials are incomplete. Verify them again.",
    );
  return { present: true, id: record._id, digest: record.credentialDigest };
}

export async function readPublicationProviderPayload(
  ctx: ReadCtx,
  libraryId: Id<"evidenceLibraries">,
) {
  const record = await readPublicationProviderRecord(ctx, libraryId);
  if (!record) return undefined;
  if (
    record.validationState !== "valid" ||
    !record.publicationSettings ||
    !record.credentialDigest
  )
    throw createError(
      "VALIDATION_ERROR",
      "Verify the publishing credentials before activating this community.",
    );
  return {
    settings: record.publicationSettings,
    encryptedCredentials: record.encryptedValue,
  };
}

export async function requireUnchangedPublicationProviders(
  ctx: ReadCtx,
  libraryId: Id<"evidenceLibraries">,
  source: LibraryCredentialSource | undefined,
) {
  const current = await readPublicationProviderSource(ctx, libraryId);
  if (
    current.present !== (source?.present ?? false) ||
    (current.present &&
      source?.present &&
      (current.id !== source.id || current.digest !== source.digest))
  )
    throw createError(
      "CONFLICT",
      "Publishing settings changed during activation. Activate the community again.",
    );
}

export const get = query({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.object({
    settings: publicationSettingsValidator,
    updatedAt: v.union(v.number(), v.null()),
    verifiedAt: v.union(v.number(), v.null()),
    custom: keptCustomValidator,
  }),
  handler: async (ctx, { libraryId }) => {
    await refuseApps(ctx);
    await requireEvidenceLibraryAccess(ctx, libraryId, "manage");
    const record = await readPublicationProviderRecord(ctx, libraryId);
    const settings = record?.publicationSettings ?? EMPTY_PUBLICATION_SETTINGS;
    return {
      settings,
      updatedAt: record?.updatedAt ?? null,
      verifiedAt: record?.lastValidatedAt ?? null,
      custom: keptCustomOf(settings, record?.customAccounts),
    };
  },
});

export const prepare = internalQuery({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.object({
    slug: v.string(),
    record: v.union(
      v.null(),
      v.object({
        _id: v.id("evidenceLibraryCredentials"),
        _creationTime: v.number(),
        ...evidenceLibraryCredentialFields,
      }),
    ),
  }),
  handler: async (ctx, { libraryId }) => {
    const { library } = await requireEvidenceLibraryAccess(
      ctx,
      libraryId,
      "manage",
    );
    await requireNoRunningOperation(
      ctx,
      libraryId,
      "Wait for activation to finish before changing publishing settings.",
    );
    return {
      slug: library.slug,
      record: await readPublicationProviderRecord(ctx, libraryId),
    };
  },
});

/**
 * Whose own Zenodo account a community's running configuration deposits in (#1237): null when it uses a token of its
 * own. The activated one's, never settings saved since and not yet activated.
 */
export const zenodoOwnerOf = internalQuery({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.union(v.null(), v.id("users")),
  handler: async (ctx, { libraryId }) => (await ctx.db.get("evidenceLibraries", libraryId))?.activeZenodoOwnerId ?? null,
});

/**
 * Whose own Zenodo account the publishing settings being activated deposit in: read from the record they were built
 * from, which activation has already checked is unchanged (its digest changes on every write).
 */
export async function zenodoOwnerOfSource(ctx: ReadCtx, source: LibraryCredentialSource | undefined): Promise<Id<"users"> | undefined> {
  if (!source?.present) return undefined;
  const record = await ctx.db.get("evidenceLibraryCredentials", source.id);
  const zenodo = record?.credentialDigest === source.digest ? record.publicationSettings?.zenodo : undefined;
  return zenodo?.mode === "own" ? zenodo.ownerUserId : undefined;
}

export const saveVerified = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    settings: publicationSettingsValidator,
    encryptedCredentials: v.string(),
    customAccounts: keptCustomValidator,
    encryptedCustomCredentials: v.string(),
    expectedUpdatedAt: v.union(v.null(), v.number()),
    verifiedAt: v.number(),
    credentialDigest: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const access = await requireEvidenceLibraryAccess(
      ctx,
      args.libraryId,
      "manage",
    );
    await requireNoRunningOperation(
      ctx,
      args.libraryId,
      "Wait for activation to finish before changing publishing settings.",
    );
    const current = await readPublicationProviderRecord(ctx, args.libraryId);
    if ((current?.updatedAt ?? null) !== args.expectedUpdatedAt)
      throw createError(
        "CONFLICT",
        "Publishing settings changed while you were editing. Reload and try again.",
      );
    const fields = {
      libraryId: args.libraryId,
      credentialKey: PUBLICATION_CREDENTIAL_KEY,
      publicationSettings: args.settings,
      encryptedValue: args.encryptedCredentials,
      customAccounts: args.customAccounts,
      encryptedCustomValue: args.encryptedCustomCredentials,
      credentialDigest: args.credentialDigest,
      validationState: "valid" as const,
      lastValidatedAt: args.verifiedAt,
      updatedAt: Date.now(),
      updatedByClerkUserId: access.clerkUserId,
    };
    if (current)
      await ctx.db.patch("evidenceLibraryCredentials", current._id, fields);
    else {
      await assertCredentialRoom(ctx, args.libraryId);
      await ctx.db.insert("evidenceLibraryCredentials", {
        ...fields,
        createdAt: fields.updatedAt,
        createdByClerkUserId: access.clerkUserId,
      });
    }
    await writeAuditLogRecord(ctx, {
      action: "evidence_library.publication_credentials.verified",
      userId: access.clerkUserId,
      metadata: {
        libraryId: args.libraryId,
        zenodo: args.settings.zenodo.mode,
        crossref: args.settings.crossref.mode,
      },
    });
    return null;
  },
});

export async function hasPublicationProviderChanges(
  ctx: ReadCtx,
  library: Doc<"evidenceLibraries">,
) {
  const current = await readPublicationProviderSource(ctx, library._id);
  return (
    (current.present ? current.digest : undefined) !==
    library.activePublicationConfigDigest
  );
}
