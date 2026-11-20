import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { encrypt } from "../lib/crypto";
import { readPublicationProviderSource, zenodoOwnerOfSource } from "./publicationProviders";
import { createReadySetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("gives a community archiving in its owner's own Zenodo account that account's token, and says to reconnect when it can't", async () => {
  const key = "a".repeat(64);
  vi.stubEnv("ENCRYPTION_KEY", key);
  // Zenodo still takes the owner's token (convex/zenodo/connectionActions.ts asks before handing it out).
  vi.stubGlobal("fetch", async () => new Response("[]", { status: 200 }));
  const { t, created, clerkUserId } = await createReadySetupFixture("zenodo_token_http");
  const libraryId = created.libraryId;
  const token = "els_" + "z".repeat(43);
  const { ownerId, connectionId } = await t.run(async (ctx) => {
    const credential = await ctx.db.query("evidenceLibraryCredentials").withIndex("by_libraryId_and_credentialKey", (q) => q.eq("libraryId", libraryId).eq("credentialKey", "library-service")).unique();
    const digest = createHash("sha256").update(token).digest("hex");
    if (credential) await ctx.db.patch("evidenceLibraryCredentials", credential._id, { credentialDigest: digest });
    else await ctx.db.insert("evidenceLibraryCredentials", { libraryId, credentialKey: "library-service", encryptedValue: "unused", credentialDigest: digest, validationState: "valid", createdByClerkUserId: clerkUserId, updatedByClerkUserId: clerkUserId, createdAt: 1, updatedAt: 1 });
    const ownerId = await ctx.db.insert("users", { clerkId: "owner", email: "owner@test.local", state: "active", createdAt: 1, updatedAt: 1 });
    const connectionId = await ctx.db.insert("zenodoConnections", { userId: ownerId, encryptedTokens: encrypt(JSON.stringify({ access: "owners-token", refresh: "r" }), key), expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, connectedAt: 1 });
    return { ownerId, connectionId };
  });
  const ask = (credential = token) => t.fetch("/api/v1/evidence-libraries/zenodo-token", { method: "POST", headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" }, body: JSON.stringify({ libraryId }) });
  // A community with a token of its own has no account here to give.
  expect((await ask()).status).toBe(409);
  await t.run((ctx) =>
    ctx.db.insert("evidenceLibraryCredentials", {
      libraryId, credentialKey: "publication-providers", encryptedValue: "unused", credentialDigest: "saved", validationState: "valid", createdByClerkUserId: clerkUserId, updatedByClerkUserId: clerkUserId, createdAt: 1, updatedAt: 1,
      publicationSettings: { zenodo: { mode: "own", ownerUserId: ownerId, license: "cc-by-4.0", defaultIdentifierPolicy: "reuse-crossref" }, crossref: { mode: "custom", prefix: "10.1234", suffixNamespace: "c", depositorName: "d", email: "d@test.local", registrant: "r" } },
    } as never),
  );
  // Saved, not activated: the running configuration still has its own token, so nothing here is its to use.
  expect((await ask()).status).toBe(409);
  // Activating reads the owner from the very settings it activates, and only while they are unchanged.
  const source = await t.run((ctx) => readPublicationProviderSource(ctx, libraryId));
  expect(await t.run((ctx) => zenodoOwnerOfSource(ctx, source))).toBe(ownerId);
  expect(await t.run((ctx) => zenodoOwnerOfSource(ctx, source.present ? { ...source, digest: "saved-since" } : source))).toBeFalsy();
  await t.run((ctx) => ctx.db.patch("evidenceLibraries", libraryId, { activeZenodoOwnerId: ownerId }));
  const answer = await ask();
  expect(answer.status).toBe(200);
  expect(await answer.json()).toMatchObject({ accessToken: "owners-token", expiresAt: expect.any(Number) });
  // Another credential gets nothing; a connection Zenodo stopped accepting is the owner's to reconnect.
  expect((await ask("els_" + "y".repeat(43))).status).toBe(401);
  await t.run((ctx) => ctx.db.patch("zenodoConnections", connectionId, { broken: true }));
  const broken = await ask();
  expect(broken.status).toBe(409);
  expect(await broken.json()).toEqual({ error: { code: "zenodo_reconnect", retryable: false } });
});
