/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { decrypt } from "../lib/crypto";
import { seedTopicLibrary } from "../../tests/helpers/topic-library-fixture";
import { createFakeClerkOAuth } from "../../tests/helpers/fake-clerk-oauth";

const modules = import.meta.glob("/convex/**/*.ts");
const encryptionKey = "ab".repeat(32);
const callback = (origin: string) => `${origin}/api/auth/callback/openscholar`;

let clerk = createFakeClerkOAuth();

beforeEach(() => {
  clerk = createFakeClerkOAuth();
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_fake");
  vi.stubEnv("ENCRYPTION_KEY", encryptionKey);
  vi.stubGlobal("fetch", clerk.wrap(async () => new Response(null, { status: 599 })));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup() {
  const t = convexTest(schema, modules);
  const libraryId = await t.run(async (ctx) =>
    (await seedTopicLibrary(ctx, "oauth", "digest", "https://oauth.example.test")).libraryId,
  );
  const sync = (origins: string[], mode: "include" | "exact" = "include") =>
    t.action(internal.evidenceLibraries.oauthClientSync.syncLibraryOAuthClient, { libraryId, origins, mode });
  const row = () =>
    t.run((ctx) =>
      ctx.db.query("evidenceLibraryOAuthClients").withIndex("by_libraryId", (q) => q.eq("libraryId", libraryId)).unique(),
    );
  return { t, libraryId, sync, row };
}

function appsNamedFor(libraryId: Id<"evidenceLibraries">) {
  return [...clerk.applications.values()].filter((app) => app.name === `evidence-library-${libraryId}`);
}

describe("a library's OpenScholar OAuth application", () => {
  it("is created once, with its secret stored encrypted", async () => {
    const { libraryId, sync, row } = await setup();

    await sync(["https://library.example.test"]);
    const writes = clerk.writes.length;
    await sync(["https://library.example.test"]);

    const [app] = appsNamedFor(libraryId);
    expect(appsNamedFor(libraryId)).toHaveLength(1);
    expect(app.redirect_uris).toEqual([callback("https://library.example.test")]);
    // Nothing changed, so the second sync asked Clerk for nothing.
    expect(clerk.writes).toHaveLength(writes);
    const saved = await row();
    expect(saved).toMatchObject({ applicationId: app.id, clientId: app.client_id, redirectUris: app.redirect_uris });
    expect(saved?.encryptedClientSecret).not.toContain(app.client_secret);
    expect(decrypt(saved!.encryptedClientSecret!, encryptionKey)).toBe(app.client_secret);
  });

  it("adopts the application an attempt created when its answer was lost", async () => {
    const { t, libraryId, sync, row } = await setup();
    // Clerk created it, but the answer never arrived: only the intent was saved.
    await t.run((ctx) =>
      ctx.db.insert("evidenceLibraryOAuthClients", { libraryId, intentAt: 1, redirectUris: [], updatedAt: 1 }),
    );
    clerk.applications.set("oa_lost", {
      id: "oa_lost",
      name: `evidence-library-${libraryId}`,
      client_id: "client_lost",
      client_secret: "secret_nobody_saved",
      redirect_uris: [callback("https://library.example.test")],
      discovery_url: "https://clerk.example.test/.well-known/openid-configuration",
    });

    await sync(["https://library.example.test"]);

    expect(appsNamedFor(libraryId).map((app) => app.id)).toEqual(["oa_lost"]);
    const saved = await row();
    expect(saved).toMatchObject({ applicationId: "oa_lost", clientId: "client_lost" });
    // Clerk shows a secret only once, so the adopted application has a new one.
    const secret = decrypt(saved!.encryptedClientSecret!, encryptionKey);
    expect(secret).not.toBe("secret_nobody_saved");
    expect(secret).toBe(clerk.applications.get("oa_lost")?.client_secret);
  });

  it("keeps the old callback through a move and drops it afterwards", async () => {
    const { libraryId, sync } = await setup();
    await sync(["https://old.example.test"]);

    await sync(["https://old.example.test", "https://new.example.test"]);
    expect(appsNamedFor(libraryId)[0].redirect_uris).toEqual([
      callback("https://new.example.test"),
      callback("https://old.example.test"),
    ]);

    await sync(["https://new.example.test"], "exact");
    expect(appsNamedFor(libraryId)[0].redirect_uris).toEqual([callback("https://new.example.test")]);
  });

  it("waits for a sync of the same library that is still under way", async () => {
    const { t, libraryId, sync } = await setup();
    await t.mutation(internal.evidenceLibraries.oauthClients.claimOAuthClientLease, {
      libraryId,
      token: "other-sync",
      purpose: "sync",
    });

    await expect(sync(["https://library.example.test"])).rejects.toThrow("under way");
    // Two overlapping syncs would each have created one.
    expect(appsNamedFor(libraryId)).toEqual([]);

    await t.mutation(internal.evidenceLibraries.oauthClients.releaseOAuthClientLease, { libraryId, token: "other-sync" });
    await sync(["https://library.example.test"]);
    expect(appsNamedFor(libraryId)).toHaveLength(1);
  });

  it("registers a callback again when Clerk dropped it after an answer was lost", async () => {
    const { libraryId, sync } = await setup();
    await sync(["https://a.example.test", "https://b.example.test"]);
    // Narrowing to b landed in Clerk, but its answer never arrived, so the
    // saved list still has both.
    appsNamedFor(libraryId)[0].redirect_uris = [callback("https://b.example.test")];

    await sync(["https://a.example.test"]);

    expect(appsNamedFor(libraryId)[0].redirect_uris).toEqual([
      callback("https://a.example.test"),
      callback("https://b.example.test"),
    ]);
  });

  it("backfills a library on a custom domain with its platform address too", async () => {
    const { t, libraryId } = await setup();
    await t.run(async (ctx) => {
      const library = await ctx.db.get("evidenceLibraries", libraryId);
      await ctx.db.patch("evidenceLibraryRuntimeBindings", library!.runtimeBindingId!, {
        canonicalBaseUrl: "https://custom.example.test",
      });
    });

    vi.useFakeTimers();
    await t.action(internal.evidenceLibraries.oauthClientSync.backfillLibraryOAuthClients, { cursor: null });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(appsNamedFor(libraryId)[0].redirect_uris).toEqual([
      callback("https://custom.example.test"),
      callback("https://oauth.example.test"),
    ]);
  });

  it("retries a library the backfill could not reach Clerk for", async () => {
    const { t, libraryId } = await setup();
    clerk.interruptNext(() => new Response(null, { status: 503 }));

    vi.useFakeTimers();
    await t.action(internal.evidenceLibraries.oauthClientSync.backfillLibraryOAuthClients, { cursor: null });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(appsNamedFor(libraryId)).toHaveLength(1);
  });

  it("does nothing for a library that has been deleted", async () => {
    const { t, libraryId, sync, row } = await setup();
    await t.run((ctx) => ctx.db.delete("evidenceLibraries", libraryId));

    await sync(["https://library.example.test"]);

    // A late sync must not bring back what the teardown removed.
    expect(appsNamedFor(libraryId)).toEqual([]);
    expect(await row()).toBeNull();
  });

  it("is made again when someone deleted it in Clerk", async () => {
    const { libraryId, sync, row } = await setup();
    await sync(["https://library.example.test"]);
    const first = (await row())!.applicationId!;
    clerk.applications.delete(first);

    await sync(["https://library.example.test", "https://www.library.example.test"]);

    const [app] = appsNamedFor(libraryId);
    expect(app.id).not.toBe(first);
    expect(app.redirect_uris).toEqual([
      callback("https://library.example.test"),
      callback("https://www.library.example.test"),
    ]);
    expect((await row())?.applicationId).toBe(app.id);
  });

  it("records what Clerk said when a call fails", async () => {
    const { sync, row } = await setup();
    clerk.interruptNext((method) =>
      method === "POST"
        ? new Response(JSON.stringify({ errors: [{ code: "form_param_invalid" }], clerk_trace_id: "trace-1" }), { status: 422 })
        : null,
    );

    await expect(sync(["https://library.example.test"])).rejects.toThrow("Clerk answered 422");

    expect((await row())?.lastError).toMatchObject({ status: 422, code: "form_param_invalid", traceId: "trace-1" });
  });

  it("is deleted with the library, along with any an unanswered attempt left", async () => {
    const { t, libraryId, sync, row } = await setup();
    await sync(["https://library.example.test"]);
    clerk.applications.set("oa_stray", {
      ...appsNamedFor(libraryId)[0],
      id: "oa_stray",
      client_id: "client_stray",
    });
    clerk.applications.set("oa_other", {
      ...appsNamedFor(libraryId)[0],
      id: "oa_other",
      name: "evidence-library-someone-else",
    });

    await t.action(internal.evidenceLibraries.oauthClientSync.deleteLibraryOAuthClient, { libraryId });
    await t.action(internal.evidenceLibraries.oauthClientSync.deleteLibraryOAuthClient, { libraryId });

    expect(appsNamedFor(libraryId)).toEqual([]);
    expect(clerk.applications.has("oa_other")).toBe(true);
    expect(await row()).toBeNull();
  });
});
