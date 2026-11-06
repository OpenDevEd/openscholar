// What the owner of a developer app does with it on the connections page: each step changes the
// OAuth application in Clerk, then the row Openscholar keeps (./apps.ts).

import { v } from "convex/values";
import { action, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { refuseApps } from "../lib/auth";
import { clerkSecretKey, ClerkApiError } from "../lib/clerk";
import { createError } from "../lib/errors";
import {
  createOAuthApplication,
  deleteOAuthApplication,
  rotateOAuthApplicationSecret,
  updateOAuthApplication,
} from "../evidenceLibraries/clerkOAuthApplications";
import { cleanDetails, detailsValidator, MAX_APPS } from "./apps";
import { appKindValidator } from "./validators";

/** Runs a Clerk call, logging what Clerk answered and telling the person in plain words when it fails. */
async function clerk<T>(step: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    console.error(`Developer app: ${step} failed in Clerk`, error instanceof ClerkApiError ? { status: error.status, code: error.code, traceId: error.traceId } : error);
    throw createError("EXTERNAL_SERVICE_ERROR", "Openscholar's sign-in service didn't answer. Try again.");
  }
}

type OwnedApp = { clerkApplicationId: string; kind: "browser" | "server" };

async function ownApp(ctx: ActionCtx, appId: Id<"developerApps">): Promise<OwnedApp> {
  const { app }: { app: OwnedApp | null } = await ctx.runQuery(internal.developerApps.apps.owner, { appId });
  return app!;
}

export const createApp = action({
  args: { ...detailsValidator, kind: appKindValidator },
  returns: v.object({ appId: v.id("developerApps"), clientId: v.string(), clientSecret: v.union(v.null(), v.string()) }),
  handler: async (ctx, { kind, ...input }): Promise<{ appId: Id<"developerApps">; clientId: string; clientSecret: string | null }> => {
    await refuseApps(ctx);
    const details = cleanDetails(input);
    const { userId, count }: { userId: Id<"users">; count: number } = await ctx.runQuery(internal.developerApps.apps.owner, {});
    if (count >= MAX_APPS) throw createError("VALIDATION_ERROR", `You can make up to ${MAX_APPS} apps.`);
    const secretKey = clerkSecretKey();
    const { application, clientSecret } = await clerk("create", () =>
      createOAuthApplication(secretKey, { name: details.name, redirectUris: details.redirectUris, public: kind === "browser", consent: true }),
    );
    const appId: Id<"developerApps"> | null = await ctx
      .runMutation(internal.developerApps.apps.insert, { ownerId: userId, ...details, kind, clientId: application.clientId, clerkApplicationId: application.id })
      .catch(async (error: unknown) => {
        await deleteOAuthApplication(secretKey, application.id);
        throw error;
      });
    if (!appId) {
      await deleteOAuthApplication(secretKey, application.id);
      throw createError("VALIDATION_ERROR", `You can make up to ${MAX_APPS} apps.`);
    }
    return { appId, clientId: application.clientId, clientSecret };
  },
});

export const updateApp = action({
  args: { appId: v.id("developerApps"), ...detailsValidator },
  returns: v.null(),
  handler: async (ctx, { appId, ...input }): Promise<null> => {
    await refuseApps(ctx);
    const app = await ownApp(ctx, appId);
    const details = cleanDetails(input);
    await clerk("update", () => updateOAuthApplication(clerkSecretKey(), app.clerkApplicationId, { name: details.name, redirectUris: details.redirectUris }));
    await ctx.runMutation(internal.developerApps.apps.update, { appId, ...details });
    return null;
  },
});

/** A server app's new secret, shown once. The old one stops working at once. */
export const newSecret = action({
  args: { appId: v.id("developerApps") },
  returns: v.string(),
  handler: async (ctx, { appId }): Promise<string> => {
    await refuseApps(ctx);
    const app = await ownApp(ctx, appId);
    if (app.kind !== "server") throw createError("VALIDATION_ERROR", "A website-only app has no secret.");
    return await clerk("new secret", () => rotateOAuthApplicationSecret(clerkSecretKey(), app.clerkApplicationId));
  },
});

/** Deletes the app here first, which stops its tokens at once, then in Clerk. */
export const deleteApp = action({
  args: { appId: v.id("developerApps") },
  returns: v.null(),
  handler: async (ctx, { appId }): Promise<null> => {
    await refuseApps(ctx);
    const app = await ownApp(ctx, appId);
    await ctx.runMutation(internal.developerApps.apps.remove, { appId });
    // Already stopped by the row's removal, so a Clerk failure leaves only an application nothing accepts.
    await deleteOAuthApplication(clerkSecretKey(), app.clerkApplicationId).catch((error: unknown) =>
      console.error("Developer app: delete failed in Clerk", { clerkApplicationId: app.clerkApplicationId, error }),
    );
    return null;
  },
});
