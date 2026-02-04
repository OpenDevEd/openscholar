"use node";

/**
 * Zotero actions - OAuth flow and API integration
 */
import { action, internalAction } from "../_generated/server";
import { buildZoteroHeaders } from "../../lib/zotero-utils";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import * as crypto from "crypto";

const ZOTERO_REQUEST_TOKEN_URL = "https://www.zotero.org/oauth/request";
const ZOTERO_ACCESS_TOKEN_URL = "https://www.zotero.org/oauth/access";
const ZOTERO_AUTHORIZE_URL = "https://www.zotero.org/oauth/authorize";
const ZOTERO_API_URL = "https://api.zotero.org";

// Type for Zotero connection
type ZoteroConnection = {
  zoteroUserId: string;
  apiKey: string;
  username?: string;
} | null;

// Type for Zotero API collection response
type ZoteroCollectionResponse = {
  key: string;
  data: {
    name: string;
    parentCollection: string | false;
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
  };
};

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

/**
 * Start OAuth flow - get request token and return authorize URL.
 */
export const startOAuth = action({
  args: {
    userId: v.id("users"),
    callbackUrl: v.string(),
  },
  returns: v.object({
    authorizeUrl: v.string(),
  }),
  handler: async (ctx, { userId, callbackUrl }) => {
    const consumerKey = process.env.ZOTERO_CLIENT_KEY;
    const consumerSecret = process.env.ZOTERO_CLIENT_SECRET;

    if (!consumerKey || !consumerSecret) {
      throw new Error("Zotero OAuth credentials not configured");
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
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("Zotero request token failed:", text);
      throw new Error("Failed to get Zotero request token");
    }

    const responseText = await response.text();
    const responseParams = new URLSearchParams(responseText);
    const oauthToken = responseParams.get("oauth_token");
    const oauthTokenSecret = responseParams.get("oauth_token_secret");

    if (!oauthToken || !oauthTokenSecret) {
      throw new Error("Invalid response from Zotero");
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
export const completeOAuth = action({
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
      return { success: false, error: "Invalid response from Zotero" };
    }

    // Save connection
    await ctx.runMutation(internal.zotero.mutations.saveConnection, {
      userId,
      zoteroUserId,
      apiKey: accessToken,
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
    userId: v.id("users"),
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
  handler: async (ctx, { userId, groupId }): Promise<Array<{ key: string; name: string; parentCollection: string | null; numItems: number; numCollections: number }>> => {
    // Get API key from connection
    const connection: ZoteroConnection = await ctx.runQuery(internal.zotero.internal.getConnection, {
      userId,
    });

    if (!connection) {
      throw new Error("Zotero not connected");
    }

    const prefix: string = groupId
      ? `/groups/${groupId}`
      : `/users/${connection.zoteroUserId}`;

    const response: Response = await fetch(`${ZOTERO_API_URL}${prefix}/collections`, {
      headers: buildZoteroHeaders(connection.apiKey),
    });

    if (!response.ok) {
      throw new Error("Failed to fetch collections from Zotero");
    }

    const data: ZoteroCollectionResponse[] = await response.json();
    return data.map((c) => ({
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
  args: {
    userId: v.id("users"),
  },
  returns: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      type: v.string(),
      numItems: v.number(),
    })
  ),
  handler: async (ctx, { userId }): Promise<Array<{ id: string; name: string; type: string; numItems: number }>> => {
    const connection: ZoteroConnection = await ctx.runQuery(internal.zotero.internal.getConnection, {
      userId,
    });

    if (!connection) {
      throw new Error("Zotero not connected");
    }

    const response: Response = await fetch(
      `${ZOTERO_API_URL}/users/${connection.zoteroUserId}/groups`,
      {
        headers: buildZoteroHeaders(connection.apiKey),
      }
    );

    if (!response.ok) {
      throw new Error("Failed to fetch groups from Zotero");
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
    userId: v.id("users"),
    collectionKey: v.optional(v.string()),
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
  handler: async (ctx, { userId, collectionKey, groupId, start = 0, limit = 50 }): Promise<{ items: Array<ZoteroItem & { hasPdfChild: boolean }>; nextCursor?: number; hasMore: boolean }> => {
    const connection: ZoteroConnection = await ctx.runQuery(internal.zotero.internal.getConnection, {
      userId,
    });

    if (!connection) {
      throw new Error("Zotero not connected");
    }

    const prefix: string = groupId
      ? `/groups/${groupId}`
      : `/users/${connection.zoteroUserId}`;

    const collectionsResponse: Response = await fetch(`${ZOTERO_API_URL}${prefix}/collections`, {
      headers: buildZoteroHeaders(connection.apiKey),
    });

    if (!collectionsResponse.ok) {
      const text = await collectionsResponse.text();
      throw new Error(`Failed to fetch collections from Zotero: ${collectionsResponse.status} ${text}`);
    }

    const collectionsData: ZoteroCollectionResponse[] = await collectionsResponse.json();
    const collectionChildren = new Map<string, string[]>();
    for (const collection of collectionsData) {
      const parent = collection.data.parentCollection || null;
      if (!parent) continue;
      const existing = collectionChildren.get(parent) ?? [];
      existing.push(collection.key);
      collectionChildren.set(parent, existing);
    }

    const allowedCollections = new Set<string>();
    if (collectionKey) {
      const stack = [collectionKey];
      while (stack.length > 0) {
        const current = stack.pop();
        if (!current || allowedCollections.has(current)) continue;
        allowedCollections.add(current);
        const children = collectionChildren.get(current) ?? [];
        for (const child of children) {
          stack.push(child);
        }
      }
    }

    const requestLimit = Math.min(limit, 50);
    const items: Array<ZoteroItem & { hasPdfChild: boolean }> = [];
    let cursor = start;
    let totalResults = 0;
    let done = false;

    while (!done && items.length < requestLimit) {
      const endpoint: string = `${prefix}/items/top`;
      const url: URL = new URL(`${ZOTERO_API_URL}${endpoint}`);
      url.searchParams.set("start", cursor.toString());
      url.searchParams.set("limit", "100");
      url.searchParams.set("itemType", "-attachment");

      const response: Response = await fetch(url.toString(), {
        headers: buildZoteroHeaders(connection.apiKey),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error("Zotero fetch failed:", response.status, text);
        throw new Error(`Failed to fetch items from Zotero: ${response.status} ${text}`);
      }

      const batchTotal: number = parseInt(response.headers.get("Total-Results") || "0", 10);
      totalResults = batchTotal;
      const data: ZoteroItemResponse[] = await response.json();

      if (data.length === 0) {
        done = true;
        break;
      }

      const filtered = collectionKey
        ? data.filter((item) => {
            const collections = item.data.collections || [];
            return collections.some((key) => allowedCollections.has(key));
          })
        : data;

      const withPdfFlags = await Promise.all(
        filtered.map(async (item) => {
          const d = item.data;
          const numChildren = item.meta?.numChildren || 0;
          let hasPdfChild = false;
          if (numChildren > 0) {
            const childrenUrl = `${ZOTERO_API_URL}${prefix}/items/${item.key}/children`;
            const childrenResponse = await fetch(childrenUrl, {
              headers: buildZoteroHeaders(connection.apiKey),
            });
            if (childrenResponse.ok) {
              const children: ZoteroItemResponse[] = await childrenResponse.json();
              hasPdfChild = children.some(
                (child) =>
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

      for (const entry of withPdfFlags) {
        if (items.length >= requestLimit) break;
        items.push(entry);
      }

      cursor += data.length;
      if (cursor >= totalResults) {
        done = true;
      }
    }

    const hasMore = totalResults !== 0 && cursor < totalResults;
    return { items, nextCursor: hasMore ? cursor : undefined, hasMore };
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
      throw new Error("Zotero not connected");
    }

    const prefix = groupId
      ? `/groups/${groupId}`
      : `/users/${connection.zoteroUserId}`;

    const response = await fetch(
      `${ZOTERO_API_URL}${prefix}/items/${itemKey}/children`,
      {
        headers: buildZoteroHeaders(connection.apiKey),
      }
    );

    if (!response.ok) {
      throw new Error("Failed to fetch attachments from Zotero");
    }

    const data: ZoteroChildItem[] = await response.json();
    
    // Filter for PDF attachments
    return data
      .filter((item) => 
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
    const connection: ZoteroConnection = await ctx.runQuery(internal.zotero.internal.getConnection, {
      userId,
    });

    if (!connection) {
      return { success: false, error: "Zotero not connected" };
    }

    try {
      const response = await fetch(downloadUrl, {
        headers: buildZoteroHeaders(connection.apiKey),
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
