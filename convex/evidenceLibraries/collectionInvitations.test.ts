/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { encrypt } from "../lib/crypto";
import { generateOpaqueToken } from "../lib/opaqueToken";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";
import { seedTopicLibrary } from "../../tests/helpers/topic-library-fixture";

const modules = import.meta.glob("/convex/**/*.ts");
const encryptionKey = "ab".repeat(32);
const mail = vi.hoisted(() => ({ sendMail: vi.fn(), close: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => mail } }));

const COLLECTION = "0e1a9c52-1b7e-4c11-9d6a-5a0c3f1e0001";
/** The addresses Clerk has verified on each account, which accepting asks it for. */
const verified: Record<string, string[]> = { user_owner: ["owner@example.org"], user_invitee: ["invitee@example.org"], user_stranger: ["stranger@example.org"] };

async function seed() {
  const t = convexTest(schema, modules);
  const libraries = [];
  for (const name of ["shelf", "other"]) {
    const credential = generateOpaqueToken("els_");
    const url = `https://${name}.example.test`;
    const libraryId = await t.run(async (ctx) => {
      const seeded = await seedTopicLibrary(ctx, name, await digestOpaqueToken(credential), url);
      await ctx.db.patch("evidenceLibraryCredentials", seeded.credentialId, { encryptedValue: encrypt(credential, encryptionKey) });
      return seeded.libraryId;
    });
    libraries.push({ credential, libraryId, url });
  }
  await t.run(async (ctx) => {
    for (const clerkId of Object.keys(verified)) await ctx.db.insert("users", { clerkId, email: verified[clerkId]![0]!, firstName: clerkId.slice(5), state: "active", createdAt: 1, updatedAt: 1 });
  });
  const [library, other] = libraries as [(typeof libraries)[0], (typeof libraries)[0]];
  /** A call as `library` makes it for one reader. */
  const call = async (name: string, clerkUserId: string, body: object = {}, from = library) => {
    const response = await t.fetch(`/api/v1/evidence-libraries/collection-invitations/${name}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${from.credential}`, "Content-Type": "application/json" },
      body: JSON.stringify({ contractVersion: 1, libraryId: from.libraryId, clerkUserId, ...body }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  const invite = async (email = "invitee@example.org", role = "editor") =>
    (await call("invite", "user_owner", { collectionId: COLLECTION, collectionName: "Early literacy", email, role })).body as { id: string; delivery: string; expiresAt: number };
  return { t, library, other, call, invite };
}

beforeEach(() => {
  vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
  vi.stubEnv("EL_COOLIFY_ENVIRONMENT", "development");
  vi.stubEnv("EL_SMTP_HOST", "smtp.example.test");
  vi.stubEnv("EL_SMTP_FROM", "libraries@example.test");
  vi.stubEnv("CLERK_SECRET_KEY", "test-clerk-key");
  vi.stubEnv("ENCRYPTION_KEY", encryptionKey);
  mail.sendMail.mockReset().mockResolvedValue({});
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
    const clerkUserId = decodeURIComponent(String(input).match(/api\.clerk\.com\/v1\/users\/([^/?]+)/)?.[1] ?? "");
    if (clerkUserId) return Response.json({ email_addresses: (verified[clerkUserId] ?? []).map((email_address) => ({ email_address, verification: { status: "verified" } })) });
    return new Response(null, { status: 204 });
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("collection invitations for an Evidence Library", () => {
  it("emails a link to the library's invitation page and lists it for whoever sent it", async () => {
    const { t, call, invite, library } = await seed();
    const sent = await invite();
    expect(sent).toMatchObject({ collectionId: COLLECTION, email: "invitee@example.org", role: "editor", delivery: "sent" });
    expect(mail.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "invitee@example.org", html: expect.stringContaining(`${library.url}/invitations/${sent.id}`) }));
    // A send from before this one that finishes late doesn't change what this one recorded.
    await t.mutation(internal.evidenceLibraries.collectionInvitations.recordDelivery, { invitationId: sent.id as Id<"itemInvitations">, attempt: sent.expiresAt - 1, delivery: "failed" });
    expect((await call("list", "user_owner")).body).toEqual({ invitations: [expect.objectContaining({ id: sent.id, delivery: "sent" })] });
    // Someone else in the library sent nothing.
    expect((await call("list", "user_invitee")).body).toEqual({ invitations: [] });
  });

  it("keeps OpenScholar's own invitation pages from showing or accepting one", async () => {
    const { t, invite } = await seed();
    const sent = await invite();
    const invitee = t.withIdentity({ subject: "user_invitee" });
    expect(await invitee.query(api.sharing.invitations.get, { invitationId: sent.id })).toBeNull();
    await expect(invitee.action(api.sharing.invitations.respond, { invitationId: sent.id as Id<"itemInvitations">, accept: true })).rejects.toThrow();
  });

  it("tells another library nothing, and refuses its changes and answers", async () => {
    const { call, invite, library, other } = await seed();
    const sent = await invite();
    expect((await call("read", "user_invitee", { invitationId: sent.id }, other)).body).toEqual({ state: "gone" });
    expect(await call("respond", "user_invitee", { invitationId: sent.id, accept: true }, other)).toEqual({ status: 404, body: { error: "not_found" } });
    expect(await call("change", "user_owner", { invitationId: sent.id, cancel: true }, other)).toEqual({ status: 404, body: { error: "not_found" } });
    expect((await call("list", "user_owner", {}, other)).body).toEqual({ invitations: [] });
    // A credential that isn't the library's own is refused before anything is read.
    expect((await call("read", "user_invitee", { invitationId: sent.id }, { ...other, libraryId: library.libraryId })).status).toBe(401);
  });

  it("accepts only for an account with the invited address verified, and answers the same when accepted again", async () => {
    const { call, invite } = await seed();
    const sent = await invite("invitee@example.org", "viewer");
    expect((await call("read", "user_stranger", { invitationId: sent.id })).body).toEqual({ state: "other" });
    expect(await call("respond", "user_stranger", { invitationId: sent.id, accept: true })).toEqual({ status: 403, body: { error: "other_address" } });
    expect((await call("read", "user_invitee", { invitationId: sent.id })).body).toEqual({ state: "pending", collectionId: COLLECTION, role: "viewer" });
    const accepted = { status: 200, body: { collectionId: COLLECTION, role: "viewer" } };
    expect(await call("respond", "user_invitee", { invitationId: sent.id, accept: true })).toEqual(accepted);
    expect(await call("respond", "user_invitee", { invitationId: sent.id, accept: true })).toEqual(accepted);
    expect((await call("read", "user_invitee", { invitationId: sent.id })).body).toEqual({ state: "accepted", collectionId: COLLECTION, role: "viewer" });
    expect((await call("list", "user_owner")).body).toEqual({ invitations: [] });
    // Inviting the address again once it answered is a new invitation with an ID of its own, which the library hasn't made a member with.
    const again = await invite("invitee@example.org", "editor");
    expect(again.id).not.toBe(sent.id);
    expect((await call("read", "user_invitee", { invitationId: again.id })).body).toEqual({ state: "pending", collectionId: COLLECTION, role: "editor" });
    expect((await call("read", "user_invitee", { invitationId: sent.id })).body).toEqual({ state: "gone" });
  });

  it("refuses an invitation someone else answered, and one that expired", async () => {
    const { call, invite } = await seed();
    const answered = await invite();
    verified.user_stranger!.push("invitee@example.org");
    try {
      await call("respond", "user_invitee", { invitationId: answered.id, accept: true });
      expect(await call("respond", "user_stranger", { invitationId: answered.id, accept: true })).toEqual({ status: 409, body: { error: "answered" } });
    } finally {
      verified.user_stranger!.pop();
    }
    const expiring = await invite("later@example.org");
    vi.useFakeTimers({ now: Date.now() + 8 * 86_400_000 });
    verified.user_invitee!.push("later@example.org");
    try {
      expect(await call("respond", "user_invitee", { invitationId: expiring.id, accept: true })).toEqual({ status: 410, body: { error: "expired" } });
    } finally {
      verified.user_invitee!.pop();
    }
  });

  it("cancels a deleted collection's invitations, and those of an account that's deleted", async () => {
    const { t, call, invite } = await seed();
    const first = await invite();
    expect((await call("cancel", "user_owner", { collectionId: COLLECTION })).status).toBe(200);
    expect((await call("read", "user_invitee", { invitationId: first.id })).body).toEqual({ state: "gone" });

    const second = await invite();
    vi.useFakeTimers();
    await t.mutation(internal.users.internal.markUserDeletedFromClerk, {
      clerkId: "user_owner", eventId: "delete-owner", eventType: "user.deleted", instanceId: "instance", occurredAt: 2, payloadSha256: "a".repeat(64),
    });
    // Gone at once, before the cleanup runs.
    expect(await call("respond", "user_invitee", { invitationId: second.id, accept: true })).toEqual({ status: 404, body: { error: "not_found" } });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await call("read", "user_invitee", { invitationId: second.id })).body).toEqual({ state: "gone" });
  });
});
