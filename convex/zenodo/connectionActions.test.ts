import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { decrypt, encrypt } from "../lib/crypto";

const KEY = "a".repeat(64);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("renews a token Zenodo stopped taking before its end, and breaks a connection Zenodo won't renew", async () => {
  vi.stubEnv("ENCRYPTION_KEY", KEY);
  vi.stubEnv("ZENODO_OAUTH_CLIENT_ID", "client");
  vi.stubEnv("ZENODO_OAUTH_CLIENT_SECRET", "secret");
  const t = convexTest(schema);
  const { userId, connectionId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkId: "ada", email: "ada@test.local", state: "active", createdAt: 1, updatedAt: 1 });
    // Weeks from its end by our clock: Zenodo says nothing of a token revoked on zenodo.org until it is used.
    const connectionId = await ctx.db.insert("zenodoConnections", { userId, encryptedTokens: encrypt(JSON.stringify({ access: "revoked", refresh: "r1" }), KEY), expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, connectedAt: 1 });
    return { userId, connectionId };
  });
  // Zenodo answers 403, not 401, to an access token it no longer takes.
  let renewal: { status: number; body: unknown } = { status: 200, body: { access_token: "fresh", refresh_token: "r2", expires_in: 3600 } };
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url.endsWith("/oauth/token")) return new Response(JSON.stringify(renewal.body), { status: renewal.status });
    const token = new Headers(init?.headers).get("Authorization");
    return new Response(token === "Bearer revoked" ? '{"status": 403, "message": "Permission denied."}' : "[]", { status: token === "Bearer revoked" ? 403 : 200 });
  });

  expect(await t.action(internal.zenodo.connectionActions.tokenFor, { userId })).toMatchObject({ accessToken: "fresh" });
  const kept = await t.run((ctx) => ctx.db.get("zenodoConnections", connectionId));
  expect(JSON.parse(decrypt(kept!.encryptedTokens, KEY))).toEqual({ access: "fresh", refresh: "r2" });
  // One it still takes is used as it is.
  expect(await t.action(internal.zenodo.connectionActions.tokenFor, { userId })).toMatchObject({ accessToken: "fresh" });

  // Revoked again, and its renewal refused: the connection is broken, for them to connect again.
  await t.run((ctx) => ctx.db.patch("zenodoConnections", connectionId, { encryptedTokens: encrypt(JSON.stringify({ access: "revoked", refresh: "r2" }), KEY) }));
  renewal = { status: 400, body: { error: "invalid_grant" } };
  await expect(t.action(internal.zenodo.connectionActions.tokenFor, { userId })).rejects.toThrow(/isn't connected any more/);
  expect(await t.run((ctx) => ctx.db.get("zenodoConnections", connectionId))).toMatchObject({ broken: true });
});
