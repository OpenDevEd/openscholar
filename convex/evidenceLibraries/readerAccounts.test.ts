/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { encrypt } from "../lib/crypto";
import { generateOpaqueToken } from "../lib/opaqueToken";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";
import { seedTopicLibrary } from "../../tests/helpers/topic-library-fixture";
import { READER_DELETION_MAX_ATTEMPTS } from "./readerDeletions";

const modules = import.meta.glob("/convex/**/*.ts");
const encryptionKey = "ab".repeat(32);

async function seedLiveLibrary(t: ReturnType<typeof convexTest>, name: string) {
  const credential = generateOpaqueToken("els_");
  const credentialDigest = await digestOpaqueToken(credential);
  const url = `https://${name}.example.test`;
  const libraryId = await t.run(async (ctx) => {
    const seeded = await seedTopicLibrary(ctx, name, credentialDigest, url);
    await ctx.db.patch("evidenceLibraryCredentials", seeded.credentialId, {
      encryptedValue: encrypt(credential, encryptionKey),
    });
    return seeded.libraryId;
  });
  return { credential, libraryId, url };
}

function deleteAccount(t: ReturnType<typeof convexTest>, clerkId: string) {
  return t.mutation(internal.users.internal.markUserDeletedFromClerk, {
    clerkId,
    eventId: `delete-${clerkId}`,
    eventType: "user.deleted",
    instanceId: "instance",
    occurredAt: 2,
    payloadSha256: "a".repeat(64),
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("reader status for a library", () => {
  it("answers active, deleted or unknown, and only to the library's own credential", async () => {
    const t = convexTest(schema, modules);
    const library = await seedLiveLibrary(t, "status");
    await t.run(async (ctx) => {
      for (const [clerkId, state] of [["active_reader", "active"], ["gone_reader", "deleted"]] as const) {
        await ctx.db.insert("users", {
          libraryItemCount: 0, clerkId, email: `${clerkId}@example.org`, state, createdAt: 1, updatedAt: 1,
        });
      }
    });
    const status = (clerkUserId: string, credential = library.credential) =>
      t.fetch("/api/v1/evidence-libraries/reader-status", {
        method: "POST",
        headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
        body: JSON.stringify({ libraryId: library.libraryId, clerkUserId }),
      });

    for (const [clerkUserId, expected] of [
      ["active_reader", "active"],
      ["gone_reader", "deleted"],
      // Not delivered by the Clerk webhook yet: a library must not delete.
      ["never_seen", "unknown"],
    ]) {
      const response = await status(clerkUserId);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: expected });
    }
    expect((await status("active_reader", generateOpaqueToken("els_"))).status).toBe(401);
  });
});

describe("deleting an OpenScholar account", () => {
  it("asks every live library to drop the reader, retrying one that is down", async () => {
    vi.useFakeTimers();
    vi.stubEnv("ENCRYPTION_KEY", encryptionKey);
    const t = convexTest(schema, modules);
    const up = await seedLiveLibrary(t, "up");
    const flaky = await seedLiveLibrary(t, "flaky");
    // A library that never went live has no readers and gets no call.
    await t.run(async (ctx) => {
      const organizationId = await ctx.db.insert("organizations", {
        clerkOrganizationId: "org_draft", evidenceLibrariesEnabled: true, name: "Draft", slug: "draft",
        state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1,
      });
      await ctx.db.insert("evidenceLibraries", {
        organizationId, name: "Draft", slug: "draft", state: "active",
        createdByClerkUserId: "owner", updatedByClerkUserId: "owner", createdAt: 1, updatedAt: 1,
      });
    });
    const calls: { url: string; method: string; authorization: string | null }[] = [];
    let flakyAnswers = 0;
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url, method: init?.method ?? "GET",
        authorization: new Headers(init?.headers).get("Authorization"),
      });
      if (url.startsWith(flaky.url)) {
        flakyAnswers += 1;
        // Down first, then gone: a library without this reader answers 404.
        return new Response(null, { status: flakyAnswers === 1 ? 503 : 404 });
      }
      return new Response(null, { status: 204 });
    });

    await deleteAccount(t, "reader_1");
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(calls).toEqual(expect.arrayContaining([
      { url: `${up.url}/api/v1/openscholar/readers/reader_1`, method: "DELETE", authorization: `Bearer ${up.credential}` },
      { url: `${flaky.url}/api/v1/openscholar/readers/reader_1`, method: "DELETE", authorization: `Bearer ${flaky.credential}` },
    ]));
    expect(calls.filter((call) => call.url.startsWith(up.url))).toHaveLength(1);
    expect(calls.filter((call) => call.url.startsWith(flaky.url))).toHaveLength(2);
    expect(calls.every((call) => call.url.startsWith(up.url) || call.url.startsWith(flaky.url))).toBe(true);
    expect(await t.run((ctx) => ctx.db.query("evidenceLibraryReaderDeletions").collect())).toEqual([]);
  });

  it("keeps a record of a library that never confirmed", async () => {
    vi.useFakeTimers();
    vi.stubEnv("ENCRYPTION_KEY", encryptionKey);
    const t = convexTest(schema, modules);
    const down = await seedLiveLibrary(t, "down");
    let attempts = 0;
    vi.stubGlobal("fetch", async () => {
      attempts += 1;
      return new Response(null, { status: 502 });
    });

    await deleteAccount(t, "reader_2");
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(attempts).toBe(READER_DELETION_MAX_ATTEMPTS);
    const rows = await t.run((ctx) => ctx.db.query("evidenceLibraryReaderDeletions").collect());
    expect(rows).toEqual([expect.objectContaining({
      libraryId: down.libraryId,
      clerkUserId: "reader_2",
      state: "failed",
      attempts: READER_DELETION_MAX_ATTEMPTS,
      lastError: { status: 502, message: "The library answered 502" },
    })]);
  });
});
