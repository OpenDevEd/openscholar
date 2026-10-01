"use node";

import { randomUUID } from "node:crypto";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import { encrypt } from "../lib/crypto";
import {
  ClerkApiError,
  type ClerkOAuthApplication,
  createOAuthApplication,
  deleteOAuthApplication,
  findOAuthApplicationsByName,
  readOAuthApplication,
  rotateOAuthApplicationSecret,
  setOAuthApplicationRedirectUris,
} from "./clerkOAuthApplications";
import { libraryOAuthApplicationName, libraryOAuthRedirectUris } from "./oauthClients";
import { requireRuntimeEnvironment } from "./runtimeActionConfig";

/**
 * `include` adds the origins' callbacks to the ones Clerk has, which is what
 * a change of address needs before it switches. `exact` keeps only these,
 * once the switch has landed.
 */
export type OAuthRedirectMode = "include" | "exact";

/** Another sync of the same library is under way; try again shortly. */
export class OAuthClientBusyError extends Error {
  readonly retryable = true;
  constructor() {
    super("Another change to this library's OpenScholar sign-in is under way");
    this.name = "OAuthClientBusyError";
  }
}

/** Worth waiting out rather than failing the step that asked. */
export function isRetryableOAuthClientError(error: unknown) {
  return error instanceof OAuthClientBusyError || (error instanceof ClerkApiError && error.retryable);
}

const configurationError = (message: string) => new Error(message);

function sortedUris(uris: readonly string[]) {
  return [...new Set(uris)].sort();
}

function sameUris(left: readonly string[], right: readonly string[]) {
  const a = sortedUris(left);
  const b = sortedUris(right);
  return a.length === b.length && a.every((uri, index) => uri === b[index]);
}

function redirectUrisFor(mode: OAuthRedirectMode, registered: readonly string[], wanted: string[]) {
  return mode === "include" ? sortedUris([...registered, ...wanted]) : wanted;
}

async function recordFailure(ctx: ActionCtx, libraryId: Id<"evidenceLibraries">, error: ClerkApiError) {
  const failure = {
    ...(error.status === undefined ? {} : { status: error.status }),
    ...(error.code === undefined ? {} : { code: error.code }),
    ...(error.traceId === undefined ? {} : { traceId: error.traceId }),
    message: error.message,
  };
  console.error("[evidence-library] Clerk OAuth application call failed", { libraryId, ...failure });
  await ctx.runMutation(internal.evidenceLibraries.oauthClients.recordOAuthClientError, { libraryId, error: failure });
}

/**
 * Runs `work` holding the library's sync lease, and records what Clerk said
 * if it fails. A sync for a library that is gone does nothing.
 */
async function withOAuthClientLease(
  ctx: ActionCtx,
  libraryId: Id<"evidenceLibraries">,
  purpose: "sync" | "delete",
  work: (token: string) => Promise<void>,
) {
  const token = randomUUID();
  const claim: "claimed" | "busy" | "gone" = await ctx.runMutation(
    internal.evidenceLibraries.oauthClients.claimOAuthClientLease,
    { libraryId, token, purpose },
  );
  if (claim === "busy") throw new OAuthClientBusyError();
  if (claim === "gone") {
    console.warn("[evidence-library] skipped the OAuth application of a deleted library", { libraryId });
    return;
  }
  try {
    await work(token);
  } catch (error) {
    if (error instanceof ClerkApiError) await recordFailure(ctx, libraryId, error);
    throw error;
  } finally {
    await ctx.runMutation(internal.evidenceLibraries.oauthClients.releaseOAuthClientLease, { libraryId, token });
  }
}

async function saveApplication(
  ctx: ActionCtx,
  libraryId: Id<"evidenceLibraries">,
  token: string,
  application: ClerkOAuthApplication,
  encryptedClientSecret?: string,
) {
  await ctx.runMutation(internal.evidenceLibraries.oauthClients.saveOAuthClient, {
    libraryId,
    token,
    applicationId: application.id,
    clientId: application.clientId,
    discoveryUrl: application.discoveryUrl,
    redirectUris: sortedUris(application.redirectUris),
    ...(encryptedClientSecret ? { encryptedClientSecret } : {}),
  });
}

/**
 * Creates the library's OAuth application, or adopts the one an earlier
 * attempt created when its answer was lost.
 */
async function provisionOAuthClient(
  ctx: ActionCtx,
  keys: { secretKey: string; encryptionKey: string },
  input: { libraryId: Id<"evidenceLibraries">; token: string; mode: OAuthRedirectMode; wanted: string[] },
) {
  const name = libraryOAuthApplicationName(input.libraryId);
  const [adopted, ...duplicates] = await findOAuthApplicationsByName(keys.secretKey, name);
  // More than one exists only when several attempts lost their answers. One
  // is enough.
  for (const duplicate of duplicates) await deleteOAuthApplication(keys.secretKey, duplicate.id);
  if (!adopted) {
    const created = await createOAuthApplication(keys.secretKey, { name, redirectUris: input.wanted });
    await saveApplication(ctx, input.libraryId, input.token, created.application, encrypt(created.clientSecret, keys.encryptionKey));
    return;
  }
  const redirectUris = redirectUrisFor(input.mode, adopted.redirectUris, input.wanted);
  const application = sameUris(adopted.redirectUris, redirectUris)
    ? adopted
    : await setOAuthApplicationRedirectUris(keys.secretKey, adopted.id, redirectUris);
  // Clerk shows a secret only once, so an adopted application gets a new one.
  const clientSecret = await rotateOAuthApplicationSecret(keys.secretKey, adopted.id);
  await saveApplication(ctx, input.libraryId, input.token, application, encrypt(clientSecret, keys.encryptionKey));
}

/** Makes Clerk's OAuth application for this library answer on `origins`. */
export async function syncLibraryOAuthClientFor(
  ctx: ActionCtx,
  input: { libraryId: Id<"evidenceLibraries">; origins: readonly string[]; mode: OAuthRedirectMode },
) {
  const keys = {
    secretKey: requireRuntimeEnvironment("CLERK_SECRET_KEY", configurationError),
    encryptionKey: requireRuntimeEnvironment("ENCRYPTION_KEY", configurationError),
  };
  const wanted = libraryOAuthRedirectUris(input.origins);
  await withOAuthClientLease(ctx, input.libraryId, "sync", async (token) => {
    const row: Doc<"evidenceLibraryOAuthClients"> | null = await ctx.runQuery(
      internal.evidenceLibraries.oauthClients.readOAuthClient,
      { libraryId: input.libraryId },
    );
    const provision = { libraryId: input.libraryId, token, mode: input.mode, wanted };
    if (!row?.applicationId || !row.encryptedClientSecret) {
      await provisionOAuthClient(ctx, keys, provision);
      return;
    }
    // Read Clerk itself: a change whose answer was lost may still have landed.
    const current = await readOAuthApplication(keys.secretKey, row.applicationId);
    if (!current) {
      // Removed from Clerk by hand: start again with a new one.
      await ctx.runMutation(internal.evidenceLibraries.oauthClients.forgetOAuthApplication, {
        libraryId: input.libraryId,
        token,
      });
      await provisionOAuthClient(ctx, keys, provision);
      return;
    }
    const redirectUris = redirectUrisFor(input.mode, current.redirectUris, wanted);
    const application = sameUris(current.redirectUris, redirectUris)
      ? current
      : await setOAuthApplicationRedirectUris(keys.secretKey, current.id, redirectUris);
    if (!sameUris(row.redirectUris, application.redirectUris)) {
      await saveApplication(ctx, input.libraryId, token, application);
    }
  });
}

/** Deletes the library's application, including any an unanswered attempt left. */
export async function deleteLibraryOAuthClientFor(ctx: ActionCtx, libraryId: Id<"evidenceLibraries">) {
  const secretKey = requireRuntimeEnvironment("CLERK_SECRET_KEY", configurationError);
  await withOAuthClientLease(ctx, libraryId, "delete", async (token) => {
    const row: Doc<"evidenceLibraryOAuthClients"> | null = await ctx.runQuery(
      internal.evidenceLibraries.oauthClients.readOAuthClient,
      { libraryId },
    );
    if (row?.applicationId) await deleteOAuthApplication(secretKey, row.applicationId);
    for (const application of await findOAuthApplicationsByName(secretKey, libraryOAuthApplicationName(libraryId))) {
      await deleteOAuthApplication(secretKey, application.id);
    }
    await ctx.runMutation(internal.evidenceLibraries.oauthClients.removeOAuthClientRecord, { libraryId, token });
  });
}

export const syncLibraryOAuthClient = internalAction({
  args: {
    libraryId: v.id("evidenceLibraries"),
    origins: v.array(v.string()),
    mode: v.union(v.literal("include"), v.literal("exact")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await syncLibraryOAuthClientFor(ctx, args);
    return null;
  },
});

export const deleteLibraryOAuthClient = internalAction({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await deleteLibraryOAuthClientFor(ctx, args.libraryId);
    return null;
  },
});

/** Minutes before each retry of one library whose sync Clerk could not take. */
const BACKFILL_RETRY_MINUTES = [1, 5, 30, 120];

/**
 * Gives every live library an OAuth application for the addresses it answers
 * on. Each library is its own job, so one that fails is retried on its own.
 * Safe to run again: a library that has one only gains missing callbacks.
 */
export const backfillLibraryOAuthClients = internalAction({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ scheduled: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const page: { libraryIds: Id<"evidenceLibraries">[]; continueCursor: string; isDone: boolean } =
      await ctx.runQuery(internal.evidenceLibraries.oauthClients.readLiveLibraryPage, args);
    for (const libraryId of page.libraryIds) {
      await ctx.scheduler.runAfter(0, internal.evidenceLibraries.oauthClientSync.backfillLibraryOAuthClient, {
        libraryId,
        attempt: 1,
      });
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.evidenceLibraries.oauthClientSync.backfillLibraryOAuthClients, {
        cursor: page.continueCursor,
      });
    }
    return { scheduled: page.libraryIds.length, isDone: page.isDone };
  },
});

/** One library's backfill, reading its addresses again when it runs. */
export const backfillLibraryOAuthClient = internalAction({
  args: { libraryId: v.id("evidenceLibraries"), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const origins: string[] | null = await ctx.runQuery(
      internal.evidenceLibraries.oauthClients.readLibraryLiveOrigins,
      { libraryId: args.libraryId },
    );
    if (!origins) return null;
    try {
      await syncLibraryOAuthClientFor(ctx, { libraryId: args.libraryId, origins, mode: "include" });
    } catch (error) {
      const delay = BACKFILL_RETRY_MINUTES[args.attempt - 1];
      if (isRetryableOAuthClientError(error) && delay !== undefined) {
        await ctx.scheduler.runAfter(delay * 60_000, internal.evidenceLibraries.oauthClientSync.backfillLibraryOAuthClient, {
          libraryId: args.libraryId,
          attempt: args.attempt + 1,
        });
        return null;
      }
      console.error("[evidence-library] OAuth application backfill failed", {
        libraryId: args.libraryId,
        attempt: args.attempt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  },
});
