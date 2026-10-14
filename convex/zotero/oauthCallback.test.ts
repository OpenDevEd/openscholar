// Zotero's sign-in callback sends the person back to the page they started on, with
// `zotero_error` when the sign-in didn't finish, and never a raw error page.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decrypt } from "../lib/crypto";
import schema from "../schema";

const KEY = "0".repeat(64);
const APP = "https://app.example.com";
let zoteroAnswers: "key" | "refuses" = "key";

beforeEach(() => {
  zoteroAnswers = "key";
  vi.stubEnv("ENCRYPTION_KEY", KEY);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP);
  vi.stubEnv("ZOTERO_CLIENT_KEY", "client-key");
  vi.stubEnv("ZOTERO_CLIENT_SECRET", "client-secret");
  // Zotero's access-token exchange, the only outside call.
  vi.stubGlobal("fetch", vi.fn(async () =>
    zoteroAnswers === "key"
      ? new Response("oauth_token=granted&oauth_token_secret=zotero-api-key&userID=15294942&username=ada", { status: 200 })
      : new Response("Invalid verifier", { status: 401 }),
  ));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** Someone who started a Zotero sign-in from `returnTo`. */
async function started(returnTo: string) {
  const t = convexTest(schema);
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { clerkId: "ada", email: "ada@example.com", state: "active", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("zoteroOAuthTokens", { token: "request-token", tokenSecret: "request-secret", userId: id, expiresAt: Date.now() + 60_000, returnTo });
    return id;
  });
  const connection = () => t.run((ctx) => ctx.db.query("zoteroConnections").withIndex("by_user", (q) => q.eq("userId", userId)).first());
  return { t, connection };
}

const back = (response: Response) => {
  expect(response.status).toBe(302);
  return response.headers.get("Location");
};

describe("Zotero's sign-in callback", () => {
  it("connects the account and returns to the page the sign-in started on, without an error left from an earlier try", async () => {
    const { t, connection } = await started("/settings/connections?zotero_error=failed");
    expect(back(await t.fetch("/api/zotero/callback?oauth_token=request-token&oauth_verifier=verifier"))).toBe(`${APP}/settings/connections`);
    const saved = await connection();
    expect(saved).toMatchObject({ zoteroUserId: "15294942", username: "ada" });
    expect(decrypt(saved!.encryptedApiKey, KEY)).toBe("zotero-api-key");
  });

  it("returns to the page the sign-in started on with the error when Zotero refuses the exchange", async () => {
    const { t, connection } = await started("/evidence-libraries/lib1/configuration?section=sources");
    zoteroAnswers = "refuses";
    expect(back(await t.fetch("/api/zotero/callback?oauth_token=request-token&oauth_verifier=verifier"))).toBe(
      `${APP}/evidence-libraries/lib1/configuration?section=sources&zotero_error=failed`,
    );
    expect(await connection()).toBeNull();
  });

  it("returns to the page with the error when Zotero comes back without a verifier, and the sign-in can't be replayed", async () => {
    const { t } = await started("/settings/connections");
    expect(back(await t.fetch("/api/zotero/callback?oauth_token=request-token"))).toBe(`${APP}/settings/connections?zotero_error=cancelled`);
    expect(back(await t.fetch("/api/zotero/callback?oauth_token=request-token&oauth_verifier=verifier"))).toBe(`${APP}/settings/connections?zotero_error=expired`);
  });

  it("sends an unknown sign-in to Connections in Settings with the error", async () => {
    const { t } = await started("/library");
    expect(back(await t.fetch("/api/zotero/callback"))).toBe(`${APP}/settings/connections?zotero_error=cancelled`);
    expect(back(await t.fetch("/api/zotero/callback?oauth_token=unknown&oauth_verifier=verifier"))).toBe(`${APP}/settings/connections?zotero_error=expired`);
  });
});
