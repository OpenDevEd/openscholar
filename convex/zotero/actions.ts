"use node";

/**
 * Zotero actions - OAuth flow and API integration
 */
import { action } from "../_generated/server";
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
    itemType: string;
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
    })
  ),
  handler: async (ctx, { userId, groupId }): Promise<Array<{ key: string; name: string; parentCollection: string | null; numItems: number }>> => {
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
      headers: {
        "Zotero-API-Key": connection.apiKey,
        "Zotero-API-Version": "3",
      },
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
        headers: {
          "Zotero-API-Key": connection.apiKey,
          "Zotero-API-Version": "3",
        },
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
      })
    ),
    totalResults: v.number(),
  }),
  handler: async (ctx, { userId, collectionKey, groupId, start = 0, limit = 50 }): Promise<{ items: ZoteroItem[]; totalResults: number }> => {
    const connection: ZoteroConnection = await ctx.runQuery(internal.zotero.internal.getConnection, {
      userId,
    });

    if (!connection) {
      throw new Error("Zotero not connected");
    }

    const prefix: string = groupId
      ? `/groups/${groupId}`
      : `/users/${connection.zoteroUserId}`;

    const endpoint: string = collectionKey
      ? `${prefix}/collections/${collectionKey}/items/top`
      : `${prefix}/items/top`;

    const url: URL = new URL(`${ZOTERO_API_URL}${endpoint}`);
    url.searchParams.set("start", start.toString());
    url.searchParams.set("limit", limit.toString());
    url.searchParams.set("itemType", "-attachment || -note"); // Exclude attachments and notes

    const response: Response = await fetch(url.toString(), {
      headers: {
        "Zotero-API-Key": connection.apiKey,
        "Zotero-API-Version": "3",
      },
    });

    if (!response.ok) {
      throw new Error("Failed to fetch items from Zotero");
    }

    const totalResults: number = parseInt(response.headers.get("Total-Results") || "0", 10);
    const data: ZoteroItemResponse[] = await response.json();

    const items: ZoteroItem[] = data.map((item) => {
      const d = item.data;
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
      };
    });

    return { items, totalResults };
  },
});
