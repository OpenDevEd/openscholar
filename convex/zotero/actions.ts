"use node";

/**
 * Zotero actions - OAuth flow and API integration
 */
import { action, internalAction } from "../_generated/server";
import { buildZoteroHeaders } from "../../lib/zotero-utils";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import * as crypto from "crypto";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

import { createError } from "../lib/errors";
import { encrypt, decryptApiKey, getKeyPrefix } from "../lib/crypto";

const ZOTERO_REQUEST_TOKEN_URL = "https://www.zotero.org/oauth/request";
const ZOTERO_ACCESS_TOKEN_URL = "https://www.zotero.org/oauth/access";
const ZOTERO_AUTHORIZE_URL = "https://www.zotero.org/oauth/authorize";
const ZOTERO_API_URL = "https://api.zotero.org";

// Type for Zotero connection
type ZoteroConnection = {
  zoteroUserId: string;
  encryptedApiKey: string;
  username?: string;
} | null;

/**
 * Resolve the plaintext Zotero API key from a connection.
 * Decrypts the encryptedApiKey field using the ENCRYPTION_KEY environment variable.
 * Logs a structured audit event via decryptApiKey.
 */
function resolveZoteroApiKey(connection: NonNullable<ZoteroConnection>, userId: string): string {
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw createError("API_KEY_ENCRYPTION_KEY_MISSING", "Encryption key not configured");
  }
  return decryptApiKey(connection.encryptedApiKey, encryptionKey, {
    userId,
    purpose: "zotero-api-call",
  });
}

async function requireCurrentUserId(ctx: ActionCtx): Promise<Id<"users">> {
  const user = await ctx.runQuery(internal.users.internal.getCurrentUser);
  if (!user) {
    throw createError("UNAUTHENTICATED", "Authentication required");
  }
  return user._id;
}

// Type for Zotero API collection response
type ZoteroCollectionResponse = {
  key: string;
  data: {
    name: string;
    parentCollection: string | false;
    deleted?: boolean | number | string;
  };
  meta?: {
    numItems?: number;
    numCollections?: number;
  };
};

// Type for Zotero API group response
type ZoteroGroupResponse = {
  id: number;
  data: {
    name: string;
    type: string;
  };
  meta?: {
    numItems?: number;
  };
};

// Type for Zotero API item response
type ZoteroItemResponse = {
  key: string;
  data: {
    title?: string;
    shortTitle?: string;
    abstractNote?: string;
    creators?: Array<{
      creatorType: string;
      name?: string;
      firstName?: string;
      lastName?: string;
    }>;
    date?: string;
    DOI?: string;
    collections?: string[];
    itemType: string;
    contentType?: string;
    parentItem?: string;
    deleted?: boolean | number | string;
  };
  meta?: {
    numChildren?: number;
  };
};

type ZoteroChildItem = {
  key: string;
  data: {
    itemType: string;
    title: string;
    contentType?: string;
    parentItem?: string;
    deleted?: boolean | number | string;
  };
};

function isDeletedFlag(value: unknown): boolean {
  if (value === true || value === 1 || value === "1") return true;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true";
  }
  return false;
}

function normalizeVisibleCollections(
  collections: ZoteroCollectionResponse[]
): ZoteroCollectionResponse[] {
  return collections.filter((collection) => !isDeletedFlag(collection.data.deleted));
}

function filterVisibleItems(
  items: ZoteroItemResponse[]
): ZoteroItemResponse[] {
  return items.filter((item) => !isDeletedFlag(item.data.deleted));
}

/**
 * Generate OAuth 1.0a signature
 */
function generateOAuthSignature(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret = ""
): string {
  // Sort params and create parameter string
  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join("&");

  // Create signature base string
  const signatureBase = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(sortedParams),
  ].join("&");

  // Create signing key
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;

  // Generate HMAC-SHA1 signature
  const hmac = crypto.createHmac("sha1", signingKey);
  hmac.update(signatureBase);
  return hmac.digest("base64");
}

/**
 * Generate OAuth 1.0a authorization header
 */
function generateOAuthHeader(
  oauthParams: Record<string, string>
): string {
  const headerParts = Object.entries(oauthParams)
    .map(([key, value]) => `${encodeURIComponent(key)}="${encodeURIComponent(value)}"`)
    .join(", ");
  return `OAuth ${headerParts}`;
}

/**
 * Generate random nonce
 */
function generateNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

function buildZoteroUrl(
  path: string,
  params?: Record<string, string | number | undefined>
): URL {
  const url = new URL(`${ZOTERO_API_URL}${path}`);
  url.searchParams.set("v", "3");
  url.searchParams.set("format", "json");
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url;
}

async function fetchCollectionPage(
  prefix: string,
  apiKey: string,
  opts: { parentKey?: string; start: number; limit: number }
): Promise<{ collections: ZoteroCollectionResponse[]; totalResults: number }> {
  const endpoint = opts.parentKey
    ? `${prefix}/collections/${opts.parentKey}/collections`
    : `${prefix}/collections/top`;
  const url = buildZoteroUrl(endpoint, {
    start: opts.start,
    limit: opts.limit,
  });
  const response = await fetch(url.toString(), {
    headers: buildZoteroHeaders(apiKey),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw createError(
      "ZOTERO_API_ERROR",
      `Failed to fetch collections from Zotero: ${response.status} ${text}`,
    );
  }

  const totalResults = parseInt(response.headers.get("Total-Results") || "0", 10);
  const collections: ZoteroCollectionResponse[] = await response.json();
  return { collections, totalResults };
}

async function fetchAllCollectionsForParent(
  prefix: string,
  apiKey: string,
  parentKey: string | undefined,
  pageSizes?: number[]
): Promise<ZoteroCollectionResponse[]> {
  const all: ZoteroCollectionResponse[] = [];
  let start = 0;
  let totalResults = Number.POSITIVE_INFINITY;
  const limit = 100;
  let page = 0;

  while (start < totalResults) {
    const result = await fetchCollectionPage(prefix, apiKey, {
      parentKey,
      start,
      limit,
    });
    totalResults = result.totalResults;
    pageSizes?.push(result.collections.length);
    console.log("[fetchCollections] Collection page stats:", {
      parentKey: parentKey || null,
      page,
      start,
      pageSize: result.collections.length,
      totalResults,
    });

    if (result.collections.length === 0) {
      break;
    }

    all.push(...result.collections);
    start += result.collections.length;
    page += 1;
  }

  return all;
}

async function fetchDescendantCollections(
  prefix: string,
  apiKey: string,
  parentKey: string,
  pageSizes?: number[],
  deletedCounter?: { count: number }
): Promise<ZoteroCollectionResponse[]> {
  const descendants: ZoteroCollectionResponse[] = [];
  const children = await fetchAllCollectionsForParent(prefix, apiKey, parentKey, pageSizes);

  for (const child of children) {
    if (isDeletedFlag(child.data.deleted)) {
      if (deletedCounter) {
        deletedCounter.count += 1;
      }
      continue;
    }
    descendants.push(child);
    if ((child.meta?.numCollections || 0) > 0) {
      const nested = await fetchDescendantCollections(
        prefix,
        apiKey,
        child.key,
        pageSizes,
        deletedCounter
      );
      descendants.push(...nested);
    }
  }

  return descendants;
}

async function fetchCollectionTreeFlat(
  prefix: string,
  apiKey: string
): Promise<{
  collections: ZoteroCollectionResponse[];
  topLevelCount: number;
  filteredDeletedCount: number;
  pageSizes: number[];
}> {
  const pageSizes: number[] = [];
  const deletedCounter = { count: 0 };
  const topCollections = await fetchAllCollectionsForParent(prefix, apiKey, undefined, pageSizes);
  const collections: ZoteroCollectionResponse[] = [];
  let topLevelCount = 0;

  for (const collection of topCollections) {
    if (isDeletedFlag(collection.data.deleted)) {
      deletedCounter.count += 1;
      continue;
    }
    topLevelCount += 1;
    collections.push(collection);
    if ((collection.meta?.numCollections || 0) > 0) {
      const descendants = await fetchDescendantCollections(
        prefix,
        apiKey,
        collection.key,
        pageSizes,
        deletedCounter
      );
      collections.push(...descendants);
    }
  }

  return {
    collections,
    topLevelCount,
    filteredDeletedCount: deletedCounter.count,
    pageSizes,
  };
}

async function fetchCollectionByKey(
  prefix: string,
  apiKey: string,
  collectionKey: string
): Promise<ZoteroCollectionResponse | null> {
  const response = await fetch(
    buildZoteroUrl(`${prefix}/collections/${collectionKey}`).toString(),
    {
      headers: buildZoteroHeaders(apiKey),
      signal: AbortSignal.timeout(30_000),
    }
  );

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const text = await response.text();
    throw createError(
      "ZOTERO_API_ERROR",
      `Failed to fetch selected collection from Zotero (${collectionKey}): ${response.status} ${text}`,
    );
  }

  const data: ZoteroCollectionResponse = await response.json();
  if (isDeletedFlag(data.data.deleted)) {
    return null;
  }
  return data;
}

async function fetchDescendantCollectionKeys(
  prefix: string,
  apiKey: string,
  parentKey: string,
  pageSizes?: number[]
): Promise<string[]> {
  const descendants = await fetchDescendantCollections(prefix, apiKey, parentKey, pageSizes);
  return descendants.map((collection) => collection.key);
}

async function fetchAllTopItemsForCollection(
  prefix: string,
  collectionKey: string,
  apiKey: string
): Promise<ZoteroItemResponse[]> {
  const all: ZoteroItemResponse[] = [];
  let start = 0;
  let totalResults = Number.POSITIVE_INFINITY;

  while (start < totalResults) {
    const url = buildZoteroUrl(`${prefix}/collections/${collectionKey}/items/top`, {
      start,
      limit: 100,
      includeTrashed: 0,
    });
    const response = await fetch(url.toString(), {
      headers: buildZoteroHeaders(apiKey),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw createError(
        "ZOTERO_API_ERROR",
        `Failed to fetch collection items from Zotero (${collectionKey}): ${response.status} ${text}`,
      );
    }

    totalResults = parseInt(response.headers.get("Total-Results") || "0", 10);
    console.log("[fetchItems] Per-request collection headers:", {
      collectionKey,
      start,
      totalResults,
      includeTrashedSet: true,
    });
    const batch: ZoteroItemResponse[] = await response.json();

    if (batch.length === 0) {
      break;
    }

    all.push(...batch);
    start += batch.length;
  }

  return all;
}

/**
 * Start OAuth flow - get request token and return authorize URL.
 */
export const startOAuth = action({
  args: {
    callbackUrl: v.string(),
  },
  returns: v.object({
    authorizeUrl: v.string(),
  }),
  handler: async (ctx, { callbackUrl }) => {
    const userId = await requireCurrentUserId(ctx);
    const consumerKey = process.env.ZOTERO_CLIENT_KEY;
    const consumerSecret = process.env.ZOTERO_CLIENT_SECRET;

    if (!consumerKey || !consumerSecret) {
      throw createError(
        "ZOTERO_OAUTH_NOT_CONFIGURED",
        "Zotero OAuth credentials not configured",
      );
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = generateNonce();

    // OAuth parameters for request token
    const oauthParams: Record<string, string> = {
      oauth_consumer_key: consumerKey,
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: timestamp,
      oauth_nonce: nonce,
      oauth_version: "1.0",
      oauth_callback: callbackUrl,
    };

    // Generate signature
    const signature = generateOAuthSignature(
      "POST",
      ZOTERO_REQUEST_TOKEN_URL,
      oauthParams,
      consumerSecret
    );
    oauthParams.oauth_signature = signature;

    // Request token from Zotero
    const response = await fetch(ZOTERO_REQUEST_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: generateOAuthHeader(oauthParams),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("Zotero request token failed:", text);
      throw createError("ZOTERO_REQUEST_TOKEN_FAILED", "Failed to get Zotero request token");
    }

    const responseText = await response.text();
    const responseParams = new URLSearchParams(responseText);
    const oauthToken = responseParams.get("oauth_token");
    const oauthTokenSecret = responseParams.get("oauth_token_secret");

    if (!oauthToken || !oauthTokenSecret) {
      throw createError("ZOTERO_INVALID_RESPONSE", "Invalid response from Zotero");
    }

    // Store request token for callback
    await ctx.runMutation(internal.zotero.mutations.storeRequestToken, {
      token: oauthToken,
      tokenSecret: oauthTokenSecret,
      userId,
    });

    // Return authorize URL
    const authorizeUrl = `${ZOTERO_AUTHORIZE_URL}?oauth_token=${oauthToken}&library_access=1&notes_access=1&write_access=0&all_groups=read`;

    return { authorizeUrl };
  },
});

/**
 * Complete OAuth flow - exchange request token for access token.
 */
export const completeOAuth = internalAction({
  args: {
    oauthToken: v.string(),
    oauthVerifier: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, { oauthToken, oauthVerifier }) => {
    const consumerKey = process.env.ZOTERO_CLIENT_KEY;
    const consumerSecret = process.env.ZOTERO_CLIENT_SECRET;

    if (!consumerKey || !consumerSecret) {
      return { success: false, error: "Zotero OAuth credentials not configured" };
    }

    // Get stored request token
    const stored = await ctx.runMutation(internal.zotero.mutations.getRequestToken, {
      token: oauthToken,
    });

    if (!stored) {
      return { success: false, error: "OAuth session expired or invalid" };
    }

    const { tokenSecret, userId } = stored;

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = generateNonce();

    // OAuth parameters for access token
    const oauthParams: Record<string, string> = {
      oauth_consumer_key: consumerKey,
      oauth_token: oauthToken,
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: timestamp,
      oauth_nonce: nonce,
      oauth_version: "1.0",
      oauth_verifier: oauthVerifier,
    };

    // Generate signature with token secret
    const signature = generateOAuthSignature(
      "POST",
      ZOTERO_ACCESS_TOKEN_URL,
      oauthParams,
      consumerSecret,
      tokenSecret
    );
    oauthParams.oauth_signature = signature;

    // Exchange for access token
    const response = await fetch(ZOTERO_ACCESS_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: generateOAuthHeader(oauthParams),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("Zotero access token failed:", text);
      return { success: false, error: "Failed to complete Zotero authorization" };
    }

    const responseText = await response.text();
    const responseParams = new URLSearchParams(responseText);
    const accessToken = responseParams.get("oauth_token_secret"); // API key is in token_secret
    const zoteroUserId = responseParams.get("userID");
    const username = responseParams.get("username");

    if (!accessToken || !zoteroUserId) {
      console.error("Zotero access token response missing fields", {
        hasAccessToken: !!accessToken,
        hasUserId: !!zoteroUserId,
        hasUsername: !!username,
        responseText,
      });
      return { success: false, error: "Invalid response from Zotero" };
    }

    // Encrypt the access token before saving
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw createError("API_KEY_ENCRYPTION_KEY_MISSING", "Encryption key not configured");
    }
    const encryptedApiKey = encrypt(accessToken, encryptionKey);
    const keyPrefix = getKeyPrefix(accessToken);

    // Save connection with encrypted key
    await ctx.runMutation(internal.zotero.mutations.saveConnection, {
      userId,
      zoteroUserId,
      encryptedApiKey,
      keyPrefix,
      username: username || undefined,
    });

    return { success: true };
  },
});

/**
 * Fetch user's Zotero collections.
 */
export const fetchCollections = action({
  args: {
    groupId: v.optional(v.string()), // If provided, fetch group collections
  },
  returns: v.array(
    v.object({
      key: v.string(),
      name: v.string(),
      parentCollection: v.union(v.string(), v.null()),
      numItems: v.number(),
      numCollections: v.number(),
    })
  ),
  handler: async (ctx, { groupId }): Promise<Array<{ key: string; name: string; parentCollection: string | null; numItems: number; numCollections: number }>> => {
    const userId = await requireCurrentUserId(ctx);
    // Get API key from connection
    const connection: ZoteroConnection = await ctx.runQuery(internal.zotero.internal.getConnection, {
      userId,
    });

    if (!connection) {
      throw createError("ZOTERO_NOT_CONNECTED", "Zotero not connected");
    }

    const apiKey = resolveZoteroApiKey(connection, userId);
    await ctx.runMutation(internal.lib.audit.writeAuditLog, {
      action: "KEY_DECRYPT",
      userId,
      metadata: { purpose: "zotero-api-key-decrypt" },
    });

    const prefix: string = groupId
      ? `/groups/${groupId}`
      : `/users/${connection.zoteroUserId}`;

    const tree = await fetchCollectionTreeFlat(
      prefix,
      apiKey
    );
    const visibleCollections = normalizeVisibleCollections(tree.collections);

    console.log("[fetchCollections] Collection tree stats:", {
      prefix,
      topLevelCount: tree.topLevelCount,
      flattenedCount: visibleCollections.length,
      filteredDeletedCount: tree.filteredDeletedCount,
      pageSizes: tree.pageSizes,
    });

    return visibleCollections.map((c) => ({
      key: c.key,
      name: c.data.name,
      parentCollection: c.data.parentCollection || null,
      numItems: c.meta?.numItems || 0,
      numCollections: c.meta?.numCollections || 0,
    }));
  },
});

/**
 * Fetch user's Zotero groups.
 */
export const fetchGroups = action({
  args: {},
  returns: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      type: v.string(),
      numItems: v.number(),
    })
  ),
  handler: async (ctx): Promise<Array<{ id: string; name: string; type: string; numItems: number }>> => {
    const userId = await requireCurrentUserId(ctx);
    const connection: ZoteroConnection = await ctx.runQuery(internal.zotero.internal.getConnection, {
      userId,
    });

    if (!connection) {
      throw createError("ZOTERO_NOT_CONNECTED", "Zotero not connected");
    }

    const apiKey = resolveZoteroApiKey(connection, userId);
    await ctx.runMutation(internal.lib.audit.writeAuditLog, {
      action: "KEY_DECRYPT",
      userId,
      metadata: { purpose: "zotero-api-key-decrypt" },
    });

    const response: Response = await fetch(
      buildZoteroUrl(`/users/${connection.zoteroUserId}/groups`).toString(),
      {
        headers: buildZoteroHeaders(apiKey),
        signal: AbortSignal.timeout(30_000),
      }
    );

    if (!response.ok) {
      throw createError("ZOTERO_API_ERROR", "Failed to fetch groups from Zotero");
    }

    const data: ZoteroGroupResponse[] = await response.json();
    return data.map((g) => ({
      id: String(g.id),
      name: g.data.name,
      type: g.data.type,
      numItems: g.meta?.numItems || 0,
    }));
  },
});

/**
 * Fetch items from Zotero library or collection.
 */
type ZoteroItem = {
  key: string;
  title: string;
  abstract?: string;
  authors: string[];
  year?: number;
  doi?: string;
  itemType: string;
  numChildren?: number;
};

export const fetchItems = action({
  args: {
    collectionKey: v.optional(v.string()),
    includeDescendants: v.optional(v.boolean()),
    groupId: v.optional(v.string()),
    start: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    items: v.array(
      v.object({
        key: v.string(),
        title: v.string(),
        abstract: v.optional(v.string()),
        authors: v.array(v.string()),
        year: v.optional(v.number()),
        doi: v.optional(v.string()),
        itemType: v.string(),
        numChildren: v.optional(v.number()),
        hasPdfChild: v.boolean(),
      })
    ),
    nextCursor: v.optional(v.number()),
    hasMore: v.boolean(),
  }),
  handler: async (
    ctx,
    { collectionKey, includeDescendants = true, groupId, start = 0, limit = 50 }
  ): Promise<{ items: Array<ZoteroItem & { hasPdfChild: boolean }>; nextCursor?: number; hasMore: boolean }> => {
    const userId = await requireCurrentUserId(ctx);
    const connection: ZoteroConnection = await ctx.runQuery(internal.zotero.internal.getConnection, {
      userId,
    });

    if (!connection) {
      throw createError("ZOTERO_NOT_CONNECTED", "Zotero not connected");
    }

    const apiKey = resolveZoteroApiKey(connection, userId);
    await ctx.runMutation(internal.lib.audit.writeAuditLog, {
      action: "KEY_DECRYPT",
      userId,
      metadata: { purpose: "zotero-api-key-decrypt" },
    });

    const prefix: string = groupId
      ? `/groups/${groupId}`
      : `/users/${connection.zoteroUserId}`;

    console.log("[fetchItems] Starting fetch with params:", {
      userId,
      collectionKey,
      includeDescendants,
      groupId,
      start,
      limit,
      prefix,
      apiKeyPresent: !!apiKey,
      apiKeyPrefix: apiKey ? apiKey.substring(0, 8) + "..." : "none",
    });

    const requestLimit = Math.min(limit, 50);
    let currentPageData: ZoteroItemResponse[] = [];
    let totalResults = 0;
    let nextCursor: number | undefined;

    if (collectionKey && includeDescendants) {
      const selectedCollection = await fetchCollectionByKey(prefix, apiKey, collectionKey);
      if (!selectedCollection) {
        console.warn("[fetchItems] Selected collection is missing/deleted; returning empty result:", {
          collectionKey,
        });
        return { items: [], nextCursor: undefined, hasMore: false };
      }
      const collectionPageSizes: number[] = [];
      const descendantCollectionKeys = await fetchDescendantCollectionKeys(
        prefix,
        apiKey,
        collectionKey,
        collectionPageSizes
      );
      const collectionKeys = [collectionKey, ...descendantCollectionKeys];

      console.log("[fetchItems] Recursive collection mode:", {
        selectedCollectionKey: collectionKey,
        selectedCollectionName: selectedCollection.data.name,
        selectedCollectionDirectItems: selectedCollection.meta?.numItems ?? 0,
        selectedCollectionNumChildren: selectedCollection.meta?.numCollections ?? 0,
        descendantCollectionCount: descendantCollectionKeys.length,
        collectionPageSizes,
      });

      if (
        (selectedCollection.meta?.numItems || 0) === 0 &&
        (selectedCollection.meta?.numCollections || 0) > 0
      ) {
        console.warn(
          "[fetchItems] Selected parent collection has 0 direct items but has child collections; using recursive fetch."
        );
      }

      const mergedMap = new Map<string, ZoteroItemResponse>();
      for (const key of collectionKeys) {
        const itemsForCollectionRaw = await fetchAllTopItemsForCollection(prefix, key, apiKey);
        const itemsForCollection = filterVisibleItems(itemsForCollectionRaw);
        console.log("[fetchItems] Collection batch stats:", {
          collectionKey: key,
          itemsRaw: itemsForCollectionRaw.length,
          itemsFiltered: itemsForCollection.length,
          includeTrashedSet: true,
        });
        for (const item of itemsForCollection) {
          if (!mergedMap.has(item.key)) {
            mergedMap.set(item.key, item);
          }
        }
      }

      const merged = Array.from(mergedMap.values());
      totalResults = merged.length;
      currentPageData = merged.slice(start, start + requestLimit);
      const computedCursor = start + currentPageData.length;
      nextCursor = computedCursor < totalResults ? computedCursor : undefined;

      console.log("[fetchItems] Recursive merged results:", {
        mergedTotalResults: totalResults,
        pageStart: start,
        pageSize: currentPageData.length,
        nextCursor,
      });
    } else {
      const endpoint = collectionKey
        ? `${prefix}/collections/${collectionKey}/items/top`
        : `${prefix}/items/top`;
      const url = buildZoteroUrl(endpoint, {
        start,
        limit: requestLimit,
        includeTrashed: 0,
      });

      console.log("[fetchItems] Fetching from URL:", url.toString());
      const response: Response = await fetch(url.toString(), {
        headers: buildZoteroHeaders(apiKey),
        signal: AbortSignal.timeout(30_000),
      });

      console.log("[fetchItems] Response status:", response.status);
      console.log("[fetchItems] Response headers:", {
        totalResults: response.headers.get("Total-Results"),
        contentType: response.headers.get("Content-Type"),
        includeTrashedSet: true,
      });

      if (!response.ok) {
        const text = await response.text();
        console.error("Zotero fetch failed:", response.status, text);
        throw createError(
          "ZOTERO_API_ERROR",
          `Failed to fetch items from Zotero: ${response.status} ${text}`,
        );
      }

      totalResults = parseInt(response.headers.get("Total-Results") || "0", 10);
      const rawPageData: ZoteroItemResponse[] = await response.json();
      currentPageData = filterVisibleItems(rawPageData);
      console.log("[fetchItems] Non-recursive page stats:", {
        itemsRaw: rawPageData.length,
        itemsFiltered: currentPageData.length,
        includeTrashedSet: true,
      });
      const computedCursor = start + rawPageData.length;
      nextCursor = computedCursor < totalResults ? computedCursor : undefined;
    }

    const items: Array<ZoteroItem & { hasPdfChild: boolean }> = await Promise.all(
      currentPageData.map(async (item) => {
        const d = item.data;
        const numChildren = item.meta?.numChildren || 0;
        let hasPdfChild = false;
        if (numChildren > 0) {
          const childrenUrl = buildZoteroUrl(`${prefix}/items/${item.key}/children`, {
            includeTrashed: 0,
          });
          const childrenResponse = await fetch(childrenUrl.toString(), {
            headers: buildZoteroHeaders(apiKey),
            signal: AbortSignal.timeout(30_000),
          });
          if (childrenResponse.ok) {
            const children: ZoteroItemResponse[] = await childrenResponse.json();
            hasPdfChild = children.some(
              (child) =>
                !isDeletedFlag(child.data.deleted) &&
                child.data.itemType === "attachment" &&
                child.data.contentType === "application/pdf"
            );
          }
        }

        return {
          key: item.key,
          title: d.title || d.shortTitle || "Untitled",
          abstract: d.abstractNote || undefined,
          authors: (d.creators || [])
            .filter((c) => c.creatorType === "author")
            .map((c) => c.name || `${c.firstName || ""} ${c.lastName || ""}`.trim()),
          year: d.date ? parseInt(d.date.match(/\d{4}/)?.[0] || "", 10) || undefined : undefined,
          doi: d.DOI || undefined,
          itemType: d.itemType,
          numChildren: item.meta?.numChildren,
          hasPdfChild,
        };
      })
    );

    const hasMore = nextCursor !== undefined;

    console.log("[fetchItems] Final result:", {
      itemsReturned: items.length,
      totalResults,
      nextCursor,
      hasMore,
    });

    return { items, nextCursor, hasMore };
  },
});

/**
 * Get attachments for a Zotero item.
 * Used by the job system to download PDFs.
 */
export const getAttachments = internalAction({
  args: {
    userId: v.id("users"),
    itemKey: v.string(),
    groupId: v.optional(v.string()),
  },
  returns: v.array(
    v.object({
      key: v.string(),
      title: v.string(),
      contentType: v.optional(v.string()),
      url: v.string(),
    })
  ),
  handler: async (ctx, { userId, itemKey, groupId }): Promise<Array<{
    key: string;
    title: string;
    contentType?: string;
    url: string;
  }>> => {
    const connection: ZoteroConnection = await ctx.runQuery(internal.zotero.internal.getConnection, {
      userId,
    });

    if (!connection) {
      throw createError("ZOTERO_NOT_CONNECTED", "Zotero not connected");
    }

    const apiKey = resolveZoteroApiKey(connection, userId);
    await ctx.runMutation(internal.lib.audit.writeAuditLog, {
      action: "KEY_DECRYPT",
      userId,
      metadata: { purpose: "zotero-api-key-decrypt" },
    });

    const prefix = groupId
      ? `/groups/${groupId}`
      : `/users/${connection.zoteroUserId}`;

    const response = await fetch(
      buildZoteroUrl(`${prefix}/items/${itemKey}/children`, {
        includeTrashed: 0,
      }).toString(),
      {
        headers: buildZoteroHeaders(apiKey),
        signal: AbortSignal.timeout(30_000),
      }
    );

    if (!response.ok) {
      throw createError("ZOTERO_API_ERROR", "Failed to fetch attachments from Zotero");
    }

    const data: ZoteroChildItem[] = await response.json();
    
    // Filter for PDF attachments
    return data
      .filter((item) => 
        !isDeletedFlag(item.data.deleted) &&
        item.data.itemType === "attachment" && 
        item.data.contentType === "application/pdf"
      )
      .map((item) => ({
        key: item.key,
        title: item.data.title,
        contentType: item.data.contentType,
        // The URL to download the file content
        url: `${ZOTERO_API_URL}${prefix}/items/${item.key}/file`,
      }));
  },
});

/**
 * Download a file from Zotero.
 * Wraps the fetch with proper authentication headers.
 */
export const downloadFile = internalAction({
  args: {
    userId: v.id("users"),
    downloadUrl: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    data: v.optional(v.string()), // Base64 encoded data
    contentType: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, { userId, downloadUrl }): Promise<{
    success: boolean;
    data?: string;
    contentType?: string;
    error?: string;
  }> => {
    if (!downloadUrl.startsWith(ZOTERO_API_URL)) {
      return { success: false, error: "Invalid download URL: must be a Zotero API URL" };
    }

    const connection: ZoteroConnection = await ctx.runQuery(internal.zotero.internal.getConnection, {
      userId,
    });

    if (!connection) {
      return { success: false, error: "Zotero not connected" };
    }

    const apiKey = resolveZoteroApiKey(connection, userId);
    await ctx.runMutation(internal.lib.audit.writeAuditLog, {
      action: "KEY_DECRYPT",
      userId,
      metadata: { purpose: "zotero-api-key-decrypt" },
    });

    try {
      const response = await fetch(downloadUrl, {
        headers: buildZoteroHeaders(apiKey),
        signal: AbortSignal.timeout(60_000),
      });

      if (!response.ok) {
        return { success: false, error: `Download failed: ${response.status}` };
      }

      const contentType = response.headers.get("Content-Type") || "application/octet-stream";
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");

      return {
        success: true,
        data: base64,
        contentType,
      };
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : String(e);
      return { success: false, error };
    }
  },
});