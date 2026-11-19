"use node";

// Zenodo's sign-in and its tokens for a person's own account (#1237): see ./connection.ts. Zenodo's access tokens
// last about an hour: each use renews one near its end, and one Zenodo refuses to renew marks the connection
// broken, for the person to connect again. Nothing is ever archived in Openscholar's account in its place.
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, type ActionCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { decrypt, encrypt } from "../lib/crypto";
import { requireAppUrl } from "../lib/env";
import { RECONNECT } from "./connection";

const ZENODO = "https://zenodo.org";
const SCOPES = "deposit:write deposit:actions";
/** An access token this close to its end is renewed before it is used. */
const RENEW_MS = 5 * 60 * 1000;
/** zenodo.org answers 403 to an unknown User-Agent. */
const USER_AGENT = "Openscholar (https://openscholar.ai)";

function client() {
  const id = process.env.ZENODO_OAUTH_CLIENT_ID;
  const secret = process.env.ZENODO_OAUTH_CLIENT_SECRET;
  if (!id || !secret) throw createError("FEATURE_DISABLED", "Connecting Zenodo isn't set up on this deployment.");
  return { id, secret };
}
const key = () => {
  const value = process.env.ENCRYPTION_KEY;
  if (!value) throw createError("FEATURE_DISABLED", "Connecting Zenodo isn't set up on this deployment.");
  return value;
};
/** Where Zenodo sends the person back: the address registered on the app. */
const redirectUri = () => `${requireAppUrl().replace(/\/+$/, "")}/settings/connections/zenodo`;
/** A path on this app, never another site's address. */
const isSafeReturnPath = (value: string) => value.startsWith("/") && !value.startsWith("//") && !value.includes("\\");

async function requireCurrentUserId(ctx: ActionCtx): Promise<Id<"users">> {
  const user = await ctx.runQuery(internal.users.internal.getCurrentUser);
  if (!user) throw createError("UNAUTHENTICATED", "Sign in first.");
  return user._id;
}

/** Zenodo's sign-in address for this person, to come back to `returnTo` (a path on this app). */
export const start = action({
  args: { returnTo: v.string() },
  returns: v.string(),
  handler: async (ctx, { returnTo }): Promise<string> => {
    if (!isSafeReturnPath(returnTo)) throw createError("VALIDATION_ERROR", "returnTo must be a path on this app");
    const userId = await requireCurrentUserId(ctx);
    const { id } = client();
    const state = crypto.randomUUID();
    await ctx.runMutation(internal.zenodo.connection.keepState, { state, userId, returnTo });
    const url = new URL(`${ZENODO}/oauth/authorize`);
    url.search = new URLSearchParams({ client_id: id, response_type: "code", scope: SCOPES, redirect_uri: redirectUri(), state }).toString();
    return url.toString();
  },
});

type TokenAnswer = { access_token: string; refresh_token?: string; expires_in?: number; user?: { id?: string | number } };

/** Asks Zenodo for tokens: for the code its sign-in handed back, or to renew with a refresh token. */
async function askTokens(body: Record<string, string>): Promise<TokenAnswer> {
  const { id, secret } = client();
  const answer = await fetch(`${ZENODO}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": USER_AGENT },
    body: new URLSearchParams({ ...body, client_id: id, client_secret: secret }).toString(),
  });
  const text = await answer.text();
  if (!answer.ok) {
    console.error(JSON.stringify({ event: "zenodo-token-refused", grant: body.grant_type, status: answer.status, body: text.slice(0, 300) }));
    throw createError("EXTERNAL_SERVICE_ERROR", answer.status === 400 || answer.status === 401 ? "Zenodo refused the connection. Connect it again." : "Zenodo didn't answer. Try again in a moment.");
  }
  return JSON.parse(text) as TokenAnswer;
}

/** The name Zenodo shows for the account, when it says. */
async function accountName(accessToken: string) {
  const answer = await fetch(`${ZENODO}/api/me`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "User-Agent": USER_AGENT } }).catch(() => null);
  if (!answer?.ok) return null;
  const me = (await answer.json().catch(() => null)) as { profile?: { full_name?: string }; username?: string; email?: string } | null;
  return me?.profile?.full_name || me?.username || me?.email || null;
}

/** Finishes the sign-in Zenodo handed back: keeps the account for this person, and answers where to go next. */
export const finish = action({
  args: { code: v.string(), state: v.string() },
  returns: v.string(),
  handler: async (ctx, { code, state }): Promise<string> => {
    const userId = await requireCurrentUserId(ctx);
    const returnTo: string | null = await ctx.runMutation(internal.zenodo.connection.takeState, { state, userId });
    if (returnTo === null) throw createError("VALIDATION_ERROR", "This Zenodo sign-in has expired or wasn't started here. Connect again.");
    const tokens = await askTokens({ grant_type: "authorization_code", code, redirect_uri: redirectUri() });
    await ctx.runMutation(internal.zenodo.connection.keep, {
      userId,
      encryptedTokens: encrypt(JSON.stringify({ access: tokens.access_token, refresh: tokens.refresh_token ?? null }), key()),
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      ...(tokens.user?.id !== undefined && { zenodoUserId: String(tokens.user.id) }),
      ...(await accountName(tokens.access_token).then((name) => (name ? { name } : {}))),
    });
    console.info(JSON.stringify({ event: "zenodo-connected", userId, zenodoUserId: tokens.user?.id ?? null }));
    return returnTo;
  },
});

/**
 * An access token for the person's own Zenodo account, renewed when it is near its end. A connection Zenodo refuses
 * to renew is marked broken and refused: their report waits for them to connect again, never going elsewhere.
 */
export async function zenodoAccessToken(ctx: Pick<ActionCtx, "runQuery" | "runMutation">, userId: Id<"users">): Promise<string> {
  const row = await ctx.runQuery(internal.zenodo.connection.stored, { userId });
  if (!row || row.broken) throw new Error(RECONNECT);
  const tokens = JSON.parse(decrypt(row.encryptedTokens, key())) as { access: string; refresh: string | null };
  if (row.expiresAt - Date.now() > RENEW_MS) return tokens.access;
  if (!tokens.refresh) {
    await ctx.runMutation(internal.zenodo.connection.renewed, { userId, broken: true });
    throw new Error(RECONNECT);
  }
  const renewed = await askTokens({ grant_type: "refresh_token", refresh_token: tokens.refresh }).catch(async (error: unknown) => {
    // Refused (revoked, or the refresh token expired) breaks the connection; Zenodo not answering leaves it for a retry.
    if (String(error).includes("refused")) await ctx.runMutation(internal.zenodo.connection.renewed, { userId, broken: true });
    throw error instanceof Error && String(error).includes("refused") ? new Error(RECONNECT) : error;
  });
  await ctx.runMutation(internal.zenodo.connection.renewed, {
    userId,
    encryptedTokens: encrypt(JSON.stringify({ access: renewed.access_token, refresh: renewed.refresh_token ?? tokens.refresh }), key()),
    expiresAt: Date.now() + (renewed.expires_in ?? 3600) * 1000,
  });
  return renewed.access_token;
}
