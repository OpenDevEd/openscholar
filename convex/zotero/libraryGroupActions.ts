"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, type ActionCtx } from "../_generated/server";
import { buildZoteroHeaders } from "../../lib/zotero-utils";
import { decryptApiKey, encrypt, getKeyPrefix } from "../lib/crypto";
import { createError } from "../lib/errors";
import { parseZoteroKeyAccess, type ZoteroGroupScopes } from "./groupAccess";
import { zoteroGroupScopesValidator } from "./libraryGroupValidators";

const ZOTERO_API_URL = "https://api.zotero.org";

type OwnerConnection = {
  clerkUserId: string;
  connection: {
    userId: Id<"users">;
    zoteroUserId: string;
    encryptedApiKey: string;
    username?: string;
  } | null;
};

type ZoteroGroupSummary = {
  id: string;
  name: string;
  isPublic: boolean;
  itemCount: number;
};

type ZoteroGroupResponse = {
  id: number;
  data: { name: string; type: string };
  meta?: { numItems?: number };
};

function toSummary(group: ZoteroGroupResponse): ZoteroGroupSummary {
  return {
    id: String(group.id),
    name: group.data.name,
    isPublic: group.data.type !== "Private",
    itemCount: group.meta?.numItems ?? 0,
  };
}

async function readOwner(
  ctx: ActionCtx,
  libraryId: Id<"evidenceLibraries">,
): Promise<{ owner: OwnerConnection; apiKey: string | null; encryptionKey: string }> {
  const owner: OwnerConnection = await ctx.runQuery(
    internal.zotero.libraryGroups.readOwnerZoteroConnection,
    { libraryId },
  );
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw createError(
      "API_KEY_ENCRYPTION_KEY_MISSING",
      "Encryption key not configured",
    );
  }
  if (!owner.connection) return { owner, apiKey: null, encryptionKey };
  const apiKey = decryptApiKey(owner.connection.encryptedApiKey, encryptionKey, {
    userId: owner.connection.userId,
    purpose: "evidence-library-zotero-group",
  });
  await ctx.runMutation(internal.lib.audit.writeAuditLog, {
    action: "KEY_DECRYPT",
    userId: owner.connection.userId,
    metadata: { purpose: "evidence-library-zotero-group", libraryId },
  });
  return { owner, apiKey, encryptionKey };
}

async function zoteroFetch(path: string, apiKey: string, params?: Record<string, string>): Promise<Response> {
  const url = new URL(path, ZOTERO_API_URL);
  url.searchParams.set("v", "3");
  url.searchParams.set("format", "json");
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
  const response = await fetch(url.toString(), {
    headers: buildZoteroHeaders(apiKey),
  });
  if (!response.ok) {
    throw createError(
      "ZOTERO_API_ERROR",
      `Zotero answered ${response.status} for ${url.pathname}`,
    );
  }
  return response;
}

async function zoteroGet(path: string, apiKey: string): Promise<unknown> {
  return await (await zoteroFetch(path, apiKey)).json();
}

const GROUPS_PAGE_SIZE = 100;
// Zotero's server refuses start values above 1000, so this is the hard end.
const GROUPS_MAX_START = 1000;

/**
 * Every page of the owner's groups, following Zotero's start/limit paging.
 * `capped` says Zotero's own ceiling stopped the list before its end.
 */
async function listAllUserGroups(
  zoteroUserId: string,
  apiKey: string,
): Promise<{ groups: ZoteroGroupResponse[]; capped: boolean }> {
  const groups: ZoteroGroupResponse[] = [];
  for (let start = 0; ; start += GROUPS_PAGE_SIZE) {
    if (start > GROUPS_MAX_START) return { groups, capped: true };
    const response = await zoteroFetch(`/users/${zoteroUserId}/groups`, apiKey, {
      start: String(start),
      limit: String(GROUPS_PAGE_SIZE),
    });
    const page = (await response.json()) as ZoteroGroupResponse[];
    groups.push(...page);
    const total = Number(response.headers.get("Total-Results") ?? page.length);
    if (groups.length >= total || page.length === 0) return { groups, capped: false };
  }
}

const groupSummaryValidator = v.object({
  id: v.string(),
  name: v.string(),
  isPublic: v.boolean(),
  itemCount: v.number(),
});

// Every group the signed-in owner's key can see, across all Zotero pages.
// Whether one is already added comes from the draft, so the page has one
// source of truth. Owners without a Zotero connection get `connected: false`.
export const listMyZoteroGroups = action({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.union(
    v.object({ connected: v.literal(false) }),
    v.object({
      connected: v.literal(true),
      username: v.optional(v.string()),
      zoteroUserId: v.string(),
      groups: v.array(groupSummaryValidator),
      capped: v.boolean(),
    }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<
    | { connected: false }
    | {
        connected: true;
        username?: string;
        zoteroUserId: string;
        groups: ZoteroGroupSummary[];
        capped: boolean;
      }
  > => {
    const { owner, apiKey } = await readOwner(ctx, args.libraryId);
    if (!owner.connection || !apiKey) return { connected: false as const };
    const { groups, capped } = await listAllUserGroups(owner.connection.zoteroUserId, apiKey);
    return {
      connected: true as const,
      username: owner.connection.username,
      zoteroUserId: owner.connection.zoteroUserId,
      groups: groups.map((group) => toSummary(group)),
      capped,
    };
  },
});

const connectResultValidator = v.object({
  groupId: v.string(),
  name: v.string(),
  isPublic: v.boolean(),
  itemCount: v.number(),
  scopes: zoteroGroupScopesValidator,
});

type ConnectResult = {
  groupId: string;
  name: string;
  isPublic: boolean;
  itemCount: number;
  scopes: ZoteroGroupScopes;
};

async function connectGroup(
  ctx: ActionCtx,
  args: { libraryId: Id<"evidenceLibraries">; groupId: string },
): Promise<ConnectResult> {
  if (!/^\d+$/.test(args.groupId)) {
    throw createError("VALIDATION_ERROR", "Zotero group ids are numbers");
  }
  const { owner, apiKey, encryptionKey } = await readOwner(ctx, args.libraryId);
  if (!owner.connection || !apiKey) {
    throw createError("ZOTERO_NOT_CONNECTED", "Connect your Zotero account first");
  }
  const scopes: ZoteroGroupScopes = parseZoteroKeyAccess(
    await zoteroGet("/keys/current", apiKey),
    args.groupId,
  );
  if (!scopes.read) {
    throw createError(
      "FORBIDDEN",
      "Your Zotero key cannot read this group. Reconnect Zotero and allow group access.",
    );
  }
  const group = toSummary(
    (await zoteroGet(`/groups/${args.groupId}`, apiKey)) as ZoteroGroupResponse,
  );
  await ctx.runMutation(internal.zotero.libraryGroups.saveLibraryZoteroGroup, {
    libraryId: args.libraryId,
    groupId: args.groupId,
    name: group.name,
    isPublic: group.isPublic,
    itemCount: group.itemCount,
    scopes,
    encryptedValue: encrypt(apiKey, encryptionKey),
    maskedHint: getKeyPrefix(apiKey),
    clerkUserId: owner.clerkUserId,
    zoteroUsername: owner.connection.username,
  });
  return {
    groupId: args.groupId,
    name: group.name,
    isPublic: group.isPublic,
    itemCount: group.itemCount,
    scopes,
  };
}

// Copies the signed-in owner's key for one group after checking, through
// Zotero, that the key can read it and whether it can write to it. Calling
// it again for a connected group replaces the stored key with the caller's
// own (reconnect).
export const connectZoteroGroup = action({
  args: { libraryId: v.id("evidenceLibraries"), groupId: v.string() },
  returns: connectResultValidator,
  handler: connectGroup,
});
