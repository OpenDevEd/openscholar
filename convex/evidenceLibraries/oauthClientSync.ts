"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import { encrypt } from "../lib/crypto";
import {
  ClerkApiError,
  createOAuthApplication,
  deleteOAuthApplication,
  findOAuthApplicationsByName,
  rotateOAuthApplicationSecret,
  setOAuthApplicationRedirectUris,
} from "./clerkOAuthApplications";
import { libraryOAuthApplicationName, libraryOAuthRedirectUris } from "./oauthClients";
import { requireRuntimeEnvironment } from "./runtimeActionConfig";

/**
 * `include` adds the origins' callbacks to the ones already registered, which
 * is what a change of address needs before it switches. `exact` registers
 * only these, once the switch has landed.
 */
export type OAuthRedirectMode = "include" | "exact";

const configurationError = (message: string) => new Error(message);

function sameUris(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((uri, index) => uri === right[index]);
}

function redirectUrisFor(mode: OAuthRedirectMode, registered: readonly string[], wanted: string[]) {
  return mode === "include" ? [...new Set([...registered, ...wanted])].sort() : wanted;
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
 * Creates the library's OAuth application, or adopts the one an earlier
 * attempt created when its answer was lost, then registers the callbacks.
 */
async function provisionOAuthClient(
  ctx: ActionCtx,
  keys: { secretKey: string; encryptionKey: string },
  libraryId: Id<"evidenceLibraries">,
  mode: OAuthRedirectMode,
  wanted: string[],
) {
  await ctx.runMutation(internal.evidenceLibraries.oauthClients.recordOAuthClientIntent, { libraryId });
  const name = libraryOAuthApplicationName(libraryId);
  const [adopted, ...duplicates] = await findOAuthApplicationsByName(keys.secretKey, name);
  // More than one exists only when several attempts lost their answers. One
  // is enough.
  for (const duplicate of duplicates) await deleteOAuthApplication(keys.secretKey, duplicate.id);
  let application;
  let clientSecret;
  if (adopted) {
    const redirectUris = redirectUrisFor(mode, adopted.redirectUris, wanted);
    application = sameUris([...adopted.redirectUris].sort(), redirectUris)
      ? adopted
      : await setOAuthApplicationRedirectUris(keys.secretKey, adopted.id, redirectUris);
    clientSecret = await rotateOAuthApplicationSecret(keys.secretKey, adopted.id);
  } else {
    ({ application, clientSecret } = await createOAuthApplication(keys.secretKey, { name, redirectUris: wanted }));
  }
  await ctx.runMutation(internal.evidenceLibraries.oauthClients.saveOAuthClient, {
    libraryId,
    applicationId: application.id,
    clientId: application.clientId,
    discoveryUrl: application.discoveryUrl,
    redirectUris: [...application.redirectUris].sort(),
    encryptedClientSecret: encrypt(clientSecret, keys.encryptionKey),
  });
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
  try {
    const row: Doc<"evidenceLibraryOAuthClients"> | null = await ctx.runQuery(
      internal.evidenceLibraries.oauthClients.readOAuthClient,
      { libraryId: input.libraryId },
    );
    if (!row?.applicationId || !row.clientId || !row.discoveryUrl) {
      await provisionOAuthClient(ctx, keys, input.libraryId, input.mode, wanted);
      return;
    }
    const redirectUris = redirectUrisFor(input.mode, row.redirectUris, wanted);
    if (sameUris(row.redirectUris, redirectUris)) return;
    let application;
    try {
      application = await setOAuthApplicationRedirectUris(keys.secretKey, row.applicationId, redirectUris);
    } catch (error) {
      // Removed from Clerk by hand: start again with a new one.
      if (!(error instanceof ClerkApiError) || error.status !== 404) throw error;
      await ctx.runMutation(internal.evidenceLibraries.oauthClients.removeOAuthClientRecord, {
        libraryId: input.libraryId,
      });
      await provisionOAuthClient(ctx, keys, input.libraryId, input.mode, wanted);
      return;
    }
    await ctx.runMutation(internal.evidenceLibraries.oauthClients.saveOAuthClient, {
      libraryId: input.libraryId,
      applicationId: application.id,
      clientId: application.clientId,
      discoveryUrl: application.discoveryUrl,
      redirectUris: [...application.redirectUris].sort(),
    });
  } catch (error) {
    if (error instanceof ClerkApiError) await recordFailure(ctx, input.libraryId, error);
    throw error;
  }
}

/** Deletes the library's application, including any an unanswered attempt left. */
export async function deleteLibraryOAuthClientFor(ctx: ActionCtx, libraryId: Id<"evidenceLibraries">) {
  const secretKey = requireRuntimeEnvironment("CLERK_SECRET_KEY", configurationError);
  try {
    const row: Doc<"evidenceLibraryOAuthClients"> | null = await ctx.runQuery(
      internal.evidenceLibraries.oauthClients.readOAuthClient,
      { libraryId },
    );
    if (row?.applicationId) await deleteOAuthApplication(secretKey, row.applicationId);
    for (const application of await findOAuthApplicationsByName(secretKey, libraryOAuthApplicationName(libraryId))) {
      await deleteOAuthApplication(secretKey, application.id);
    }
    await ctx.runMutation(internal.evidenceLibraries.oauthClients.removeOAuthClientRecord, { libraryId });
  } catch (error) {
    if (error instanceof ClerkApiError) await recordFailure(ctx, libraryId, error);
    throw error;
  }
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

/**
 * Gives every live library an OAuth application for the addresses it answers
 * on. Safe to run again: a library that has one only gains missing callbacks.
 */
export const backfillLibraryOAuthClients = internalAction({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ synced: v.number(), failed: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const page: {
      libraries: { libraryId: Id<"evidenceLibraries">; origins: string[] }[];
      continueCursor: string;
      isDone: boolean;
    } = await ctx.runQuery(internal.evidenceLibraries.oauthClients.readLiveLibraryOrigins, args);
    let synced = 0;
    let failed = 0;
    for (const library of page.libraries) {
      try {
        await syncLibraryOAuthClientFor(ctx, { ...library, mode: "include" });
        synced += 1;
      } catch (error) {
        failed += 1;
        console.error("[evidence-library] OAuth application backfill failed", {
          libraryId: library.libraryId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.evidenceLibraries.oauthClientSync.backfillLibraryOAuthClients, {
        cursor: page.continueCursor,
      });
    }
    return { synced, failed, isDone: page.isDone };
  },
});
