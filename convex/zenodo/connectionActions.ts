"use node";

// Zenodo's sign-in and its tokens for a person's own account (#1237): see ./connection.ts. Zenodo's access tokens
// last 60 days: a use near the end renews one, and one Zenodo refuses to renew marks the connection broken, for the
// person to connect again. Nothing is ever archived in Openscholar's account in its place.
import { v } from "convex/values";
import { ProviderHttpError } from "@opendeved/doi-sync-core";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, type ActionCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { decrypt, encrypt } from "../lib/crypto";
import { localPath, requireAppUrl } from "../lib/env";
import { refuseApps } from "../lib/auth";
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
async function requireCurrentUserId(ctx: ActionCtx): Promise<Id<"users">> {
  const user = await ctx.runQuery(internal.users.internal.getCurrentUser);
  if (!user) throw createError("UNAUTHENTICATED", "Sign in first.");
  return user._id;
}

/** Zenodo's sign-in address for this person, to come back to `returnTo` (a path on this app). */
export const start = action({
  args: { returnTo: v.string() },
  returns: v.string(),
  handler: async (ctx, { returnTo: asked }): Promise<string> => {
    // An app signed in as the person never connects an account in their name.
    await refuseApps(ctx);
    const returnTo = localPath(asked);
    if (returnTo === null) throw createError("VALIDATION_ERROR", "returnTo must be a path on this app");
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
    // Retryable (429, 5xx) or not, as the registrar reads it: Zenodo being busy never fails an archive for good.
    throw new ProviderHttpError({ provider: "zenodo", status: answer.status, body: text.slice(0, 300) });
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

/**
 * Finishes the sign-in Zenodo handed back: keeps the account for the person who started it, and answers where to go
 * next. The state, a secret only their browser was given, says who that is; no other sign-in is asked for.
 */
export const finish = action({
  args: { code: v.string(), state: v.string() },
  returns: v.string(),
  handler: async (ctx, { code, state }): Promise<string> => {
    const started: { userId: Id<"users">; returnTo: string } | null = await ctx.runMutation(internal.zenodo.connection.takeState, { state });
    if (started === null) throw createError("VALIDATION_ERROR", "This Zenodo sign-in has expired or wasn't started here. Connect again.");
    const { userId, returnTo } = started;
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
 * Renewals may run side by side (two reports at once): the first to save wins, and the other takes what it saved,
 * so a refresh token Zenodo has already replaced never breaks a working connection, nor overwrites a newer one.
 */
export async function zenodoAccessToken(ctx: Pick<ActionCtx, "runQuery" | "runMutation">, userId: Id<"users">, tries = 3): Promise<string> {
  const row = await ctx.runQuery(internal.zenodo.connection.stored, { userId });
  if (!row || row.broken) throw new Error(RECONNECT);
  const tokens = JSON.parse(decrypt(row.encryptedTokens, key())) as { access: string; refresh: string | null };
  if (row.expiresAt - Date.now() > RENEW_MS) return tokens.access;
  const save = (change: { encryptedTokens: string; expiresAt: number } | { broken: true }): Promise<boolean> =>
    ctx.runMutation(internal.zenodo.connection.renewed, { userId, from: row.encryptedTokens, ...change });
  const theirs = (): Promise<string> => {
    if (tries <= 1) throw new ProviderHttpError({ provider: "zenodo", status: 503, body: "The connection kept changing while it was renewed." });
    return zenodoAccessToken(ctx, userId, tries - 1);
  };
  let renewed: TokenAnswer;
  try {
    if (!tokens.refresh) throw new ProviderHttpError({ provider: "zenodo", status: 401, body: "No refresh token" });
    renewed = await askTokens({ grant_type: "refresh_token", refresh_token: tokens.refresh });
  } catch (error) {
    // Refused (revoked, or the refresh token expired) breaks the connection; Zenodo not answering leaves it for a retry.
    if (!(error instanceof ProviderHttpError) || error.retryable) throw error;
    if (await save({ broken: true })) throw new Error(RECONNECT);
    return theirs();
  }
  const encryptedTokens = encrypt(JSON.stringify({ access: renewed.access_token, refresh: renewed.refresh_token ?? tokens.refresh }), key());
  if (await save({ encryptedTokens, expiresAt: Date.now() + (renewed.expires_in ?? 3600) * 1000 })) return renewed.access_token;
  return theirs();
}
