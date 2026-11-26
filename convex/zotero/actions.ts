"use node";

/**
 * Zotero actions - OAuth flow and API integration
 */
import { action, internalAction } from "../_generated/server";
import { buildZoteroHeaders } from "../../lib/zotero-utils";
import { internal } from "../_generated/api";
import { v, type Infer } from "convex/values";
import * as crypto from "crypto";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

import { createError } from "../lib/errors";
import { localPath } from "../lib/env";
import { ZOTERO_ABSTRACT_MAX, ZOTERO_LIST_PAGE, ZOTERO_NAME_MAX, ZOTERO_PAGE, ZOTERO_TITLE_MAX, checkZoteroIds } from "./libraryValidators";
import { MAX_AUTHORS } from "../lib/listCaps";
import { encrypt, decryptApiKey, getKeyPrefix } from "../lib/crypto";
import { PDFDocument } from "@cantoo/pdf-lib";
import { downloadPdf } from "../../lib/pdf/download";
import { MAX_PDF_BYTES, MAX_PDF_MB } from "../../lib/assistant/files";
import { paperKey } from "../../lib/papers/paper-ref";

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
    publicationTitle?: string;
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

/**
 * Start OAuth flow - get request token and return authorize URL.
 */
export const startOAuth = action({
  args: {
    callbackUrl: v.string(),
    returnTo: v.optional(v.string()),
  },
  returns: v.object({
    authorizeUrl: v.string(),
  }),
  handler: async (ctx, { callbackUrl, returnTo: asked }) => {
    const returnTo = asked === undefined ? undefined : (localPath(asked) ?? undefined);
    if (asked !== undefined && returnTo === undefined) {
      throw createError("VALIDATION_ERROR", "returnTo must be a path on this app");
    }
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
      returnTo,
    });

    // Return authorize URL. Group write access lets Evidence Libraries write
    // back to a group; the person can still refuse it on the Zotero page.
    const authorizeUrl = `${ZOTERO_AUTHORIZE_URL}?oauth_token=${oauthToken}&library_access=1&notes_access=1&write_access=0&all_groups=write`;

    return { authorizeUrl };
  },
});

type SignInResult = { returnTo?: string; error?: "cancelled" | "expired" | "failed" };

/**
 * Completes a Zotero sign-in: exchanges the request token for the person's API key and saves
 * the connection. Returns the page the sign-in started on, and why it failed when it did.
 */
export const completeOAuth = internalAction({
  args: {
    oauthToken: v.optional(v.string()),
    oauthVerifier: v.optional(v.string()),
  },
  returns: v.object({
    returnTo: v.optional(v.string()),
    error: v.optional(v.union(v.literal("cancelled"), v.literal("expired"), v.literal("failed"))),
  }),
  handler: async (ctx, { oauthToken, oauthVerifier }): Promise<SignInResult> => {
    // Zotero comes back without its token or verifier when the person doesn't approve the key.
    if (!oauthToken) return { error: "cancelled" };

    // The request token is used once, whatever happens next.
    const stored: {
      tokenSecret: string;
      userId: Id<"users">;
      returnTo?: string;
      expired: boolean;
    } | null = await ctx.runMutation(internal.zotero.mutations.getRequestToken, {
      token: oauthToken,
    });

    if (!stored) return { error: "expired" };
    const { tokenSecret, userId, returnTo } = stored;
    if (stored.expired) return { returnTo, error: "expired" };
    if (!oauthVerifier) return { returnTo, error: "cancelled" };

    try {
      await saveZoteroKey(ctx, { oauthToken, oauthVerifier, tokenSecret, userId });
      return { returnTo };
    } catch (error) {
      console.error("Zotero sign-in failed:", error);
      return { returnTo, error: "failed" };
    }
  },
});

/** Exchanges a request token the person approved for their Zotero API key and saves it. Throws, with the reason, when it can't. */
async function saveZoteroKey(
  ctx: ActionCtx,
  { oauthToken, oauthVerifier, tokenSecret, userId }: { oauthToken: string; oauthVerifier: string; tokenSecret: string; userId: Id<"users"> },
) {
  const consumerKey = process.env.ZOTERO_CLIENT_KEY;
  const consumerSecret = process.env.ZOTERO_CLIENT_SECRET;
  if (!consumerKey || !consumerSecret) throw new Error("Zotero OAuth credentials not configured");

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_token: oauthToken,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_nonce: generateNonce(),
    oauth_version: "1.0",
    oauth_verifier: oauthVerifier,
  };
  oauthParams.oauth_signature = generateOAuthSignature("POST", ZOTERO_ACCESS_TOKEN_URL, oauthParams, consumerSecret, tokenSecret);

  const response = await fetch(ZOTERO_ACCESS_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: generateOAuthHeader(oauthParams),
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error(`Zotero refused the access token exchange: ${response.status} ${responseText}`);

  const responseParams = new URLSearchParams(responseText);
  const accessToken = responseParams.get("oauth_token_secret"); // The API key is the token secret.
  const zoteroUserId = responseParams.get("userID");
  const username = responseParams.get("username");
  if (!accessToken || !zoteroUserId) {
    throw new Error(`Zotero's access token response is incomplete: key ${accessToken ? "present" : "missing"}, user ID ${zoteroUserId ? "present" : "missing"}`);
  }

  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) throw new Error("ENCRYPTION_KEY is not set, so the key can't be saved");
  await ctx.runMutation(internal.zotero.mutations.saveConnection, {
    userId,
    zoteroUserId,
    encryptedApiKey: encrypt(accessToken, encryptionKey),
    keyPrefix: getKeyPrefix(accessToken),
    username: username || undefined,
  });
}


type ZoteroPage<T> = { page: T[]; next?: number };

/** One page of Zotero's, from `start`, with where the next starts when there are more. */
async function zoteroPage<T>(path: string, apiKey: string, start: number, what: string): Promise<ZoteroPage<T>> {
  if (!Number.isSafeInteger(start) || start < 0) throw createError("VALIDATION_ERROR", "Read from 0 up.");
  const response = await fetch(buildZoteroUrl(path, { start, limit: ZOTERO_LIST_PAGE }).toString(), { headers: buildZoteroHeaders(apiKey) });
  if (!response.ok) throw createError("ZOTERO_API_ERROR", `Failed to fetch ${what} from Zotero: ${response.status} ${await response.text()}`);
  const page: T[] = await response.json();
  const total = parseInt(response.headers.get("Total-Results") || "0", 10);
  return { page, ...(start + page.length < total ? { next: start + page.length } : {}) };
}

/** The person's Zotero API key and the address of their own library or one of their groups, the decryption logged. */
async function zoteroAccess(ctx: ActionCtx, userId: Id<"users">, groupId?: string) {
  checkZoteroIds({ groupId });
  const connection: ZoteroConnection = await ctx.runQuery(internal.zotero.internal.getConnection, { userId });
  if (!connection) throw createError("ZOTERO_NOT_CONNECTED", "Zotero not connected");
  const apiKey = resolveZoteroApiKey(connection, userId);
  await ctx.runMutation(internal.lib.audit.writeAuditLog, { action: "KEY_DECRYPT", userId, metadata: { purpose: "zotero-api-key-decrypt" } });
  return { apiKey, connection, prefix: groupId ? `/groups/${groupId}` : `/users/${connection.zoteroUserId}` };
}

/**
 * The PDF attached to an item of the person's own Zotero library, or a group's of theirs, put in their chat as one of
 * its files (../assistant/files.ts `keepZoteroPdf`), for the assistant to read by pages. It's read the way an
 * extraction reads one (../../lib/pdf/download.ts), never kept in the shared paper PDF store: the file is the person's.
 */
export const pdfToChat = internalAction({
  args: { userId: v.id("users"), workspaceId: v.id("workspaces"), threadId: v.id("assistantThreads"), itemKey: v.string(), groupId: v.optional(v.string()) },
  returns: v.object({ file: v.id("assistantFiles"), name: v.string(), pages: v.number() }),
  handler: async (ctx, { userId, workspaceId, threadId, itemKey, groupId }): Promise<{ file: Id<"assistantFiles">; name: string; pages: number }> => {
    checkZoteroIds({ groupId, itemKey });
    const { apiKey, connection, prefix } = await zoteroAccess(ctx, userId, groupId);
    const at = groupId ? `zotero://select/groups/${groupId}/items/${itemKey}` : `zotero://select/users/${connection!.zoteroUserId}/items/${itemKey}`;
    const got = await downloadPdf(at, { zoteroConnection: { apiKey, userId: connection!.zoteroUserId }, maxBytes: MAX_PDF_BYTES });
    if (!got.success || !got.pdfBlob) {
      if (got.error?.includes("byte cap")) throw createError("VALIDATION_ERROR", `This item's PDF is larger than the ${MAX_PDF_MB} MB a chat file can be.`);
      throw createError("NOT_FOUND", got.error === "No PDF attachment found in Zotero" ? "This Zotero item has no PDF attached." : `Zotero didn't give this item's PDF (${got.error ?? "no file"}). Try again in a moment.`);
    }
    const bytes = new Uint8Array(await got.pdfBlob.arrayBuffer());
    let pages: number;
    try {
      pages = (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();
    } catch {
      throw createError("VALIDATION_ERROR", "This item's attachment isn't a PDF that opens.");
    }
    // The item's title names the file, as its name does in Zotero.
    const item = await fetch(buildZoteroUrl(`${prefix}/items/${itemKey}`).toString(), { headers: buildZoteroHeaders(apiKey) });
    const title = item.ok ? ((await item.json()) as ZoteroItemResponse).data?.title : undefined;
    const name = `${(title || itemKey).slice(0, ZOTERO_TITLE_MAX)}.pdf`;
    const storageId = await ctx.storage.store(new Blob([bytes], { type: "application/pdf" }));
    try {
      const file: Id<"assistantFiles"> = await ctx.runMutation(internal.assistant.files.keepZoteroPdf, { userId, workspaceId, threadId, storageId, name, bytes: bytes.length, pages });
      return { file, name, pages };
    } catch (error) {
      // Refused (the plan's hourly allowance, say): nothing keeps the stored bytes.
      await ctx.storage.delete(storageId);
      throw error;
    }
  },
});

const collectionValidator = v.object({ key: v.string(), name: v.string(), parentCollection: v.union(v.string(), v.null()), numItems: v.number(), numCollections: v.number() });
type Collection = Infer<typeof collectionValidator>;

/** One page of a person's Zotero collections, or a group's of theirs: every level, each naming the one it sits in. With `under`, one level alone: "top", or the ones inside the collection it names. */
export const collectionsOf = internalAction({
  args: { userId: v.id("users"), groupId: v.optional(v.string()), start: v.number(), under: v.optional(v.string()) },
  returns: v.object({ page: v.array(collectionValidator), next: v.optional(v.number()) }),
  handler: async (ctx, { userId, groupId, start, under }): Promise<ZoteroPage<Collection>> => {
    const { apiKey, prefix } = await zoteroAccess(ctx, userId, groupId);
    if (under !== undefined && under !== "top") checkZoteroIds({ collectionKey: under });
    const { page, next } = await zoteroPage<ZoteroCollectionResponse>(`${prefix}/collections${under === undefined ? "" : under === "top" ? "/top" : `/${under}/collections`}`, apiKey, start, "collections");
    const shown = page
      .filter((collection) => !isDeletedFlag(collection.data.deleted))
      .map((c) => ({ key: c.key, name: c.data.name, parentCollection: c.data.parentCollection || null, numItems: c.meta?.numItems || 0, numCollections: c.meta?.numCollections || 0 }));
    return { page: shown, ...(next === undefined ? {} : { next }) };
  },
});

const groupValidator = v.object({ id: v.string(), name: v.string(), type: v.string(), numItems: v.number() });
type Group = Infer<typeof groupValidator>;

/** One page of the Zotero groups a person is in. */
export const groupsOf = internalAction({
  args: { userId: v.id("users"), start: v.number() },
  returns: v.object({ page: v.array(groupValidator), next: v.optional(v.number()) }),
  handler: async (ctx, { userId, start }): Promise<ZoteroPage<Group>> => {
    const { apiKey, connection } = await zoteroAccess(ctx, userId);
    const { page, next } = await zoteroPage<ZoteroGroupResponse>(`/users/${connection!.zoteroUserId}/groups`, apiKey, start, "groups");
    return { page: page.map((g) => ({ id: String(g.id), name: g.data.name, type: g.data.type, numItems: g.meta?.numItems || 0 })), ...(next === undefined ? {} : { next }) };
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
  venueName?: string;
  numChildren?: number;
};

/** `pdfs: false` leaves out whether each item has a PDF, which takes a request an item. */
type ItemsRequest = { collectionKey?: string; groupId?: string; start?: number; limit?: number; pdfs?: boolean };
/** A page of the items at the top of a person's Zotero library or one of its collections (not its sub-collections'), or a group's of theirs. */
async function itemsFor(ctx: ActionCtx, userId: Id<"users">, { collectionKey, groupId, start = 0, limit = 50, pdfs = true }: ItemsRequest): Promise<{ items: Array<ZoteroItem & { hasPdfChild: boolean }>; nextCursor?: number; hasMore: boolean }> {
  checkZoteroIds({ groupId, collectionKey });
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(limit) || limit < 1) throw createError("VALIDATION_ERROR", "Read Zotero items from 0 up, at least one at a time.");
  const { apiKey, prefix } = await zoteroAccess(ctx, userId, groupId);
  const url = buildZoteroUrl(collectionKey ? `${prefix}/collections/${collectionKey}/items/top` : `${prefix}/items/top`, {
    start,
    limit: Math.min(limit, ZOTERO_PAGE),
    includeTrashed: 0,
    // A file or a note at the top of a library isn't a paper: Zotero leaves out the files, and the notes are left out below.
    itemType: "-attachment",
    // In the order they were added, not Zotero's last-changed first, so an item edited or added while a job reads page by page moves none of the others.
    // shortcut: one deleted meanwhile still moves the rest up one; pin a job's item keys when it starts if that matters.
    sort: "dateAdded",
    direction: "asc",
  });
  const response: Response = await fetch(url.toString(), { headers: buildZoteroHeaders(apiKey) });
  if (!response.ok) {
    const text = await response.text();
    console.error("Zotero fetch failed:", response.status, text);
    throw createError("ZOTERO_API_ERROR", `Failed to fetch items from Zotero: ${response.status} ${text}`);
  }
  const totalResults = parseInt(response.headers.get("Total-Results") || "0", 10);
  const rawPageData: ZoteroItemResponse[] = await response.json();
  const currentPageData = filterVisibleItems(rawPageData);
  const nextCursor = start + rawPageData.length < totalResults ? start + rawPageData.length : undefined;

    // Whether each has a PDF takes a request an item: four at a time, as Zotero asks, a refusal said rather than read as none.
    const papers = currentPageData.filter((item) => item.data.itemType !== "note" && item.data.itemType !== "attachment");
    const items: Array<ZoteroItem & { hasPdfChild: boolean }> = [];
    for (let at = 0; at < papers.length; at += 4) items.push(...(await Promise.all(
      papers.slice(at, at + 4).map(async (item) => {
        const d = item.data;
        const numChildren = item.meta?.numChildren || 0;
        let hasPdfChild = false;
        if (pdfs && numChildren > 0) {
          const childrenUrl = buildZoteroUrl(`${prefix}/items/${item.key}/children`, {
            includeTrashed: 0,
          });
          const childrenResponse = await fetch(childrenUrl.toString(), {
            headers: buildZoteroHeaders(apiKey),
          });
          if (!childrenResponse.ok) throw createError("ZOTERO_API_ERROR", `Zotero didn't say which items have a PDF (${childrenResponse.status}). Try again in a moment.`);
          {
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
          venueName: d.publicationTitle || undefined,
          numChildren: item.meta?.numChildren,
          hasPdfChild,
        };
      }),
    )));

    const hasMore = nextCursor !== undefined;
    return { items, nextCursor, hasMore };
}

/** The same, for a person a Convex function names (./library.ts). */
export const itemsOf = internalAction({
  args: { userId: v.id("users"), collectionKey: v.optional(v.string()),
    groupId: v.optional(v.string()),
    start: v.optional(v.number()),
    limit: v.optional(v.number()), },
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
        venueName: v.optional(v.string()),
        numChildren: v.optional(v.number()),
        hasPdfChild: v.boolean(),
      })
    ),
    nextCursor: v.optional(v.number()),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, { userId, ...request }): Promise<{ items: Array<ZoteroItem & { hasPdfChild: boolean }>; nextCursor?: number; hasMore: boolean }> => itemsFor(ctx, userId, request),
});

/**
 * Items `first` to `last` (from 1, at most ZOTERO_PAGE of them) of a person's Zotero library, or of one
 * collection of it and not its sub-collections, as papers a screening or an extraction reads (#328): each
 * named zotero:user:KEY, or zotero:group:KEY in a group, as extraction names Zotero papers. One page of
 * Zotero's: a job reads the next as it goes on. `ended` once Zotero has no more.
 */
export const papersOf = internalAction({
  args: { userId: v.id("users"), collectionKey: v.optional(v.string()), groupId: v.optional(v.string()), first: v.number(), last: v.number() },
  returns: v.object({
    papers: v.array(v.object({ key: v.string(), paper: v.string(), title: v.string(), abstract: v.optional(v.string()), authors: v.array(v.string()), year: v.optional(v.number()), doi: v.optional(v.string()), venue: v.optional(v.string()), pdfUrl: v.string() })),
    ended: v.boolean(),
    zoteroUserId: v.string(),
  }),
  handler: async (ctx, { userId, collectionKey, groupId, first, last }): Promise<{ papers: Array<{ key: string; paper: string; title: string; abstract?: string; authors: string[]; year?: number; doi?: string; venue?: string; pdfUrl: string }>; ended: boolean; zoteroUserId: string }> => {
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last - first + 1 > ZOTERO_PAGE) throw createError("VALIDATION_ERROR", `Read Zotero items from 1 up, at most ${ZOTERO_PAGE} at a time.`);
    const connection: ZoteroConnection = await ctx.runQuery(internal.zotero.internal.getConnection, { userId });
    if (!connection) throw createError("ZOTERO_NOT_CONNECTED", "Zotero not connected");
    const read = await itemsFor(ctx, userId, { collectionKey, groupId, start: first - 1, limit: last - first + 1, pdfs: false });
    // Bounded as a saved paper's are: a pasted abstract or a long author list can't outgrow what a job's tables hold.
    const papers = read.items.map((item) => ({
      key: item.key,
      paper: paperKey({ source: "zotero", library: groupId ? "group" : "user", owner: groupId ?? connection.zoteroUserId, key: item.key }),
      // Where its PDF is, as extraction reads a Zotero paper's (../extraction/expandSources.ts).
      pdfUrl: groupId ? `zotero://select/groups/${groupId}/items/${item.key}` : `zotero://select/users/${connection.zoteroUserId}/items/${item.key}`,
      title: item.title.slice(0, ZOTERO_TITLE_MAX),
      authors: item.authors.slice(0, MAX_AUTHORS).map((name) => name.slice(0, ZOTERO_NAME_MAX)),
      ...(item.abstract ? { abstract: item.abstract.slice(0, ZOTERO_ABSTRACT_MAX) } : {}),
      ...(item.year === undefined ? {} : { year: item.year }),
      ...(item.doi ? { doi: item.doi.slice(0, ZOTERO_NAME_MAX) } : {}),
      ...(item.venueName ? { venue: item.venueName.slice(0, ZOTERO_NAME_MAX) } : {}),
    }));
    return { papers, ended: read.nextCursor === undefined, zoteroUserId: connection.zoteroUserId };
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