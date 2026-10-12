/// <reference types="vite/client" />
// Each account's verified addresses, read from Clerk for accounts the webhook hasn't kept them for.
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
const modules = import.meta.glob("/convex/**/*.ts");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("verified addresses", () => {
  it("keeps the addresses Clerk verified for each account it lists", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test");
    const userId = await t.run((ctx) => ctx.db.insert("users", { clerkId: "user_ada", email: "ada@example.org", state: "active", createdAt: 1, updatedAt: 1 }));
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([
      { id: "user_ada", primary_email_address_id: "e1", email_addresses: [
        { id: "e1", email_address: "ada@example.org", verification: { status: "verified" } },
        { id: "e2", email_address: "Ada@Lab.example.org", verification: { status: "verified" } },
        { id: "e3", email_address: "ada@unverified.example.org", verification: { status: "unverified" } },
      ] },
      { id: "user_unknown", primary_email_address_id: "e4", email_addresses: [{ id: "e4", email_address: "who@example.org", verification: { status: "verified" } }] },
    ])));
    await t.action(internal.users.verifiedEmails.refresh, {});
    expect((await t.run((ctx) => ctx.db.get("users", userId)))?.verifiedEmails).toEqual(["ada@example.org", "ada@lab.example.org"]);
  });
});
