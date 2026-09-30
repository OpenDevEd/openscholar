import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../lib/functions";
import { requireEvidenceLibraryAccess } from "../evidenceLibraries/access";
import { writeAuditLogRecord } from "../lib/audit";
import { createError } from "../lib/errors";
import {
  evidenceLibraryZoteroGroupValidator,
  zoteroGroupCredentialKey,
  zoteroGroupScopesValidator,
} from "./libraryGroupValidators";

type ReadCtx = Pick<QueryCtx | MutationCtx, "db">;

export async function findLibraryZoteroGroup(
  ctx: ReadCtx,
  libraryId: Id<"evidenceLibraries">,
  groupId: string,
) {
  return await ctx.db
    .query("evidenceLibraryZoteroGroups")
    .withIndex("by_libraryId_and_groupId", (q) =>
      q.eq("libraryId", libraryId).eq("groupId", groupId),
    )
    .unique();
}

async function findGroupCredential(
  ctx: ReadCtx,
  libraryId: Id<"evidenceLibraries">,
  groupId: string,
) {
  return await ctx.db
    .query("evidenceLibraryCredentials")
    .withIndex("by_libraryId_and_credentialKey", (q) =>
      q
        .eq("libraryId", libraryId)
        .eq("credentialKey", zoteroGroupCredentialKey(groupId)),
    )
    .unique();
}


// Every connected group with its encrypted key, for deploy-time assembly.
export async function readLibraryZoteroGroupCredentials(
  ctx: ReadCtx,
  libraryId: Id<"evidenceLibraries">,
) {
  const groups = await ctx.db
    .query("evidenceLibraryZoteroGroups")
    .withIndex("by_libraryId", (q) => q.eq("libraryId", libraryId))
    .take(100);
  const result: {
    groupId: string;
    encryptedApiKey: string;
    scopes: { read: boolean; write: boolean };
  }[] = [];
  for (const group of groups) {
    const credential = await findGroupCredential(ctx, libraryId, group.groupId);
    if (!credential) {
      throw createError(
        "INVALID_DATA",
        `Zotero group ${group.groupId} has no stored key`,
      );
    }
    result.push({
      groupId: group.groupId,
      encryptedApiKey: credential.encryptedValue,
      scopes: group.scopes,
    });
  }
  return result;
}

export const listLibraryZoteroGroups = query({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.array(evidenceLibraryZoteroGroupValidator),
  handler: async (ctx, args) => {
    await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
    return await ctx.db
      .query("evidenceLibraryZoteroGroups")
      .withIndex("by_libraryId", (q) => q.eq("libraryId", args.libraryId))
      .take(100);
  },
});

// The signed-in owner's own Zotero connection, for the connect actions.
// Access is checked here because actions cannot read the database.
export const readOwnerZoteroConnection = internalQuery({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.object({
    clerkUserId: v.string(),
    connection: v.union(
      v.null(),
      v.object({
        userId: v.id("users"),
        zoteroUserId: v.string(),
        encryptedApiKey: v.string(),
        username: v.optional(v.string()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const access = await requireEvidenceLibraryAccess(
      ctx,
      args.libraryId,
      "manage",
    );
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", access.clerkUserId))
      .unique();
    const connection = user
      ? await ctx.db
          .query("zoteroConnections")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .first()
      : null;
    return {
      clerkUserId: access.clerkUserId,
      connection: connection
        ? {
            userId: connection.userId,
            zoteroUserId: connection.zoteroUserId,
            encryptedApiKey: connection.encryptedApiKey,
            username: connection.username,
          }
        : null,
    };
  },
});

// Stores the group row and the encrypted copy of the owner's key together.
export const saveLibraryZoteroGroup = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    groupId: v.string(),
    name: v.string(),
    isPublic: v.boolean(),
    itemCount: v.number(),
    scopes: zoteroGroupScopesValidator,
    encryptedValue: v.string(),
    maskedHint: v.string(),
    clerkUserId: v.string(),
    zoteroUsername: v.optional(v.string()),
  },
  returns: v.id("evidenceLibraryZoteroGroups"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const credentialKey = zoteroGroupCredentialKey(args.groupId);
    const credential = await findGroupCredential(
      ctx,
      args.libraryId,
      args.groupId,
    );
    const credentialFields = {
      libraryId: args.libraryId,
      credentialKey,
      encryptedValue: args.encryptedValue,
      maskedHint: args.maskedHint,
      validationState: "valid" as const,
      lastValidatedAt: now,
      updatedByClerkUserId: args.clerkUserId,
      updatedAt: now,
    };
    if (credential) {
      await ctx.db.patch("evidenceLibraryCredentials", credential._id, credentialFields);
    } else {
      await ctx.db.insert("evidenceLibraryCredentials", {
        ...credentialFields,
        createdByClerkUserId: args.clerkUserId,
        createdAt: now,
      });
    }
    const groupFields = {
      libraryId: args.libraryId,
      groupId: args.groupId,
      name: args.name,
      isPublic: args.isPublic,
      itemCount: args.itemCount,
      connectedByClerkUserId: args.clerkUserId,
      connectedByZoteroUsername: args.zoteroUsername,
      connectedAt: now,
      scopes: args.scopes,
      credentialKey,
    };
    const existing = await findLibraryZoteroGroup(
      ctx,
      args.libraryId,
      args.groupId,
    );
    const groupRowId = existing
      ? (await ctx.db.replace("evidenceLibraryZoteroGroups", existing._id, groupFields),
        existing._id)
      : await ctx.db.insert("evidenceLibraryZoteroGroups", groupFields);
    await writeAuditLogRecord(ctx, {
      action: existing
        ? "evidence_library.zotero_group.reconnected"
        : "evidence_library.zotero_group.connected",
      userId: args.clerkUserId,
      metadata: { libraryId: args.libraryId, groupId: args.groupId },
    });
    return groupRowId;
  },
});

export const removeZoteroGroup = mutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    groupId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const access = await requireEvidenceLibraryAccess(
      ctx,
      args.libraryId,
      "manage",
    );
    const group = await findLibraryZoteroGroup(ctx, args.libraryId, args.groupId);
    if (!group) {
      throw createError("NOT_FOUND", "This Zotero group is not connected");
    }
    await ctx.db.delete("evidenceLibraryZoteroGroups", group._id);
    const credential = await findGroupCredential(
      ctx,
      args.libraryId,
      args.groupId,
    );
    if (credential) {
      await ctx.db.delete("evidenceLibraryCredentials", credential._id);
    }
    await writeAuditLogRecord(ctx, {
      action: "evidence_library.zotero_group.removed",
      userId: access.clerkUserId,
      metadata: { libraryId: args.libraryId, groupId: args.groupId },
    });
    return null;
  },
});
