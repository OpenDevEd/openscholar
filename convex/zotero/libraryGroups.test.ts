/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import { decrypt, encrypt } from "../lib/crypto";
import { assembleEvidenceLibraryRuntimePayload } from "../evidenceLibraries/runtimeConfiguration";
import {
  createActivatedSetupFixture,
  essentialSetupSections,
  toSectionRows,
} from "../../tests/helpers/evidence-library-setup-fixture";
import { readLibraryZoteroGroupCredentials } from "./libraryGroups";
import { zoteroSourceEntry } from "./sourceCredentials";

const ENCRYPTION_KEY = "44".repeat(32);
const OWNER_KEY = "owner-zotero-key-0001";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Zotero answers: the owner's key may write to group 42 and only read 77.
function zoteroNetwork() {
  const requests: string[] = [];
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    requests.push(url.pathname);
    const headers = new Headers(init?.headers);
    if (headers.get("Zotero-API-Key") !== OWNER_KEY) {
      return new Response("Invalid key", { status: 403 });
    }
    if (url.pathname === "/keys/current") {
      return jsonResponse({
        key: OWNER_KEY,
        userID: 15294942,
        username: "owner",
        access: {
          user: { library: true, write: false },
          groups: {
            all: { library: true, write: false },
            "42": { library: true, write: true },
          },
        },
      });
    }
    if (url.pathname === "/groups/42") {
      return jsonResponse({
        id: 42,
        data: { name: "Climate evidence", type: "PublicOpen" },
        meta: { numItems: 312 },
      });
    }
    if (url.pathname === "/groups/77") {
      return jsonResponse({
        id: 77,
        data: { name: "Private notes", type: "Private" },
        meta: { numItems: 5 },
      });
    }
    if (url.pathname === "/users/15294942/groups") {
      const all = [
        { id: 42, data: { name: "Climate evidence", type: "PublicOpen" }, meta: { numItems: 312 } },
        { id: 77, data: { name: "Private notes", type: "Private" }, meta: { numItems: 5 } },
        ...Array.from({ length: 130 }, (_, index) => ({
          id: 1000 + index,
          data: { name: `Group ${index}`, type: "Private" },
          meta: { numItems: index },
        })),
      ];
      const start = Number(url.searchParams.get("start") ?? "0");
      const limit = Number(url.searchParams.get("limit") ?? "25");
      const body = JSON.stringify(all.slice(start, start + limit));
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/json", "Total-Results": String(all.length) },
      });
    }
    return jsonResponse({ message: "Unexpected test request" }, 500);
  });
  return { fetchImpl, requests };
}

async function ownerWithZotero(suffix: string) {
  const fixture = await createActivatedSetupFixture(suffix);
  await fixture.t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkId: fixture.clerkUserId,
      email: `${fixture.clerkUserId}@example.test`,
      state: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("zoteroConnections", {
      userId,
      zoteroUserId: "15294942",
      encryptedApiKey: encrypt(OWNER_KEY, ENCRYPTION_KEY),
      keyPrefix: "owner-z...",
      username: "owner",
      connectedAt: 1,
    });
  });
  return fixture;
}

describe("Evidence Library Zotero groups", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
    vi.stubEnv("ENCRYPTION_KEY", ENCRYPTION_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("tells an owner without a Zotero account to connect first", async () => {
    const fixture = await createActivatedSetupFixture("nozotero");
    await expect(
      fixture.admin.action(api.zotero.libraryGroupActions.listMyZoteroGroups, {
        libraryId: fixture.created.libraryId,
      }),
    ).resolves.toEqual({ connected: false });
  });

  it("connects a group with an encrypted copy of the owner's key and its scopes", async () => {
    const fixture = await ownerWithZotero("connect");
    const network = zoteroNetwork();
    vi.stubGlobal("fetch", network.fetchImpl);
    const libraryId = fixture.created.libraryId;

    const connected = await fixture.admin.action(
      api.zotero.libraryGroupActions.connectZoteroGroup,
      { libraryId, groupId: "42" },
    );
    expect(connected).toEqual({
      groupId: "42",
      name: "Climate evidence",
      isPublic: true,
      itemCount: 312,
      scopes: { read: true, write: true },
    });
    const readOnly = await fixture.admin.action(
      api.zotero.libraryGroupActions.connectZoteroGroup,
      { libraryId, groupId: "77" },
    );
    expect(readOnly.scopes).toEqual({ read: true, write: false });
    expect(readOnly.isPublic).toBe(false);

    const groups = await fixture.admin.query(
      api.zotero.libraryGroups.listLibraryZoteroGroups,
      { libraryId },
    );
    expect(groups.map((group) => [group.groupId, group.scopes.write])).toEqual([
      ["42", true],
      ["77", false],
    ]);
    expect(groups[0].connectedByClerkUserId).toBe(fixture.clerkUserId);
    expect(groups[0].connectedByZoteroUsername).toBe("owner");

    const credential = await fixture.t.run((ctx) =>
      ctx.db
        .query("evidenceLibraryCredentials")
        .withIndex("by_libraryId_and_credentialKey", (q) =>
          q.eq("libraryId", libraryId).eq("credentialKey", "zotero-group:42"),
        )
        .unique(),
    );
    expect(credential?.encryptedValue).not.toContain(OWNER_KEY);
    expect(decrypt(credential!.encryptedValue, ENCRYPTION_KEY)).toBe(OWNER_KEY);

    const mine = await fixture.admin.action(
      api.zotero.libraryGroupActions.listMyZoteroGroups,
      { libraryId },
    );
    expect(mine).toMatchObject({ connected: true, username: "owner" });
    if (!mine.connected) throw new Error("expected a connection");
    // Every Zotero page is read, not just the first 25.
    expect(mine.groups).toHaveLength(132);
    expect(mine.groups[0]).toEqual({ id: "42", name: "Climate evidence", isPublic: true, itemCount: 312 });
  });

  it("removes the group row together with its key", async () => {
    const fixture = await ownerWithZotero("remove");
    vi.stubGlobal("fetch", zoteroNetwork().fetchImpl);
    const libraryId = fixture.created.libraryId;
    await fixture.admin.action(api.zotero.libraryGroupActions.connectZoteroGroup, {
      libraryId,
      groupId: "42",
    });
    await fixture.admin.mutation(api.zotero.libraryGroups.removeZoteroGroup, {
      libraryId,
      groupId: "42",
    });
    const remaining = await fixture.t.run(async (ctx) => ({
      groups: await ctx.db.query("evidenceLibraryZoteroGroups").take(10),
      keys: (
        await ctx.db
          .query("evidenceLibraryCredentials")
          .withIndex("by_libraryId", (q) => q.eq("libraryId", libraryId))
          .collect()
      ).filter((row) => row.credentialKey.startsWith("zotero-group:")),
    }));
    expect(remaining).toEqual({ groups: [], keys: [] });
  });

  it("keeps keys out of the draft and adds them only when the runtime payload is built", async () => {
    const fixture = await ownerWithZotero("assemble");
    vi.stubGlobal("fetch", zoteroNetwork().fetchImpl);
    const libraryId = fixture.created.libraryId;
    await fixture.admin.action(api.zotero.libraryGroupActions.connectZoteroGroup, {
      libraryId,
      groupId: "77",
    });
    const sources = [{ ...zoteroSourceEntry("77"), writebackEnabled: true }];
    await fixture.admin.mutation(api.evidenceLibraries.mutations.saveDraftSections, {
      libraryId,
      sections: toSectionRows({ sources }),
      expectedEditVersion: fixture.activated.editVersion,
    });
    const draft = await fixture.admin.query(api.evidenceLibraries.queries.getDraft, {
      libraryId,
    });
    const savedSources = draft.sections.find((row) => row.sectionKey === "sources");
    expect(savedSources?.payload).toEqual(sources);
    expect(JSON.stringify(draft)).not.toContain(OWNER_KEY);

    const prepared = await fixture.t.run((ctx) =>
      readLibraryZoteroGroupCredentials(ctx, libraryId),
    );
    const payload = assembleEvidenceLibraryRuntimePayload({
      encryptionKey: ENCRYPTION_KEY,
      libraryId,
      revision: { key: "r2", createdAt: 10 },
      origins: {
        app: "https://openscholar.example.test",
        convexSite: "https://convex.example.test",
      },
      sections: { ...essentialSetupSections, sources },
      credentials: {
        encryptedMachine: encrypt(`els_${"a".repeat(43)}`, ENCRYPTION_KEY),
        encryptedAuthentication: encrypt("a".repeat(32), ENCRYPTION_KEY),
        encryptedDatabaseUrl: encrypt(
          "postgresql://library:password@postgres:5432/library",
          ENCRYPTION_KEY,
        ),
      },
      search: {
        host: "http://meilisearch:7700",
        encryptedKey: encrypt("search-key", ENCRYPTION_KEY),
        index: "evidence_library",
      },
      storage: {
        url: "https://storage.example.test",
        encryptedServiceRoleKey: encrypt("storage-key", ENCRYPTION_KEY),
        privateBucket: "private",
        publicBucket: "public",
        maxPdfBytes: 10_485_760,
      },
      zoteroGroups: prepared,
    });
    expect(payload.runtimeConfig.sources).toEqual([
      expect.objectContaining({
        key: "zotero-77",
        groupId: "77",
        apiKey: OWNER_KEY,
        // The owner's key cannot write to group 77, so write back stays off.
        writebackEnabled: false,
      }),
    ]);
  });
});
