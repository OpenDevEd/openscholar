import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { internal } from "../_generated/api";
import { createReadySetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";

it("finds the paper a community's record page shows, at its own address or its domain, once it's published", async () => {
  const { t, created, clerkUserId } = await createReadySetupFixture("paper_links");
  const libraryId = created.libraryId;
  const origin = await t.run(async (ctx) => {
    const binding = await ctx.db.query("evidenceLibraryRuntimeBindings").withIndex("by_libraryId", (q) => q.eq("libraryId", libraryId)).first();
    await ctx.db.insert("evidenceLibraryDomains", { libraryId, host: "climate.example.org", verificationToken: "token", verificationHost: "example.org", role: "primary", state: "added", generation: 0, createdByClerkUserId: clerkUserId, createdAt: 1, updatedAt: 1 });
    const record = { libraryId, generation: 1, publishedRevision: 1, topicIds: [], metadata: null, groupKey: "g" };
    await ctx.db.insert("topicLocations", { ...record, itemKey: "ABCD2345", state: "published", openalexId: "W1", doi: "10.1000/one" });
    await ctx.db.insert("topicLocations", { ...record, itemKey: "EFGH6789", state: "unpublished", openalexId: "W2", doi: null });
    return binding!.targetBaseUrl;
  });
  const paper = (at: string, itemKey: string) => t.query(internal.evidenceLibraries.paperLinks.recordPaper, { origin: at, itemKey });
  expect(await paper(origin, "ABCD2345")).toEqual({ openalexId: "W1", doi: "10.1000/one" });
  expect(await paper("https://climate.example.org", "ABCD2345")).toEqual({ openalexId: "W1", doi: "10.1000/one" });
  // One the community took down, and an address no community answers at, name nothing.
  expect(await paper("https://climate.example.org", "EFGH6789")).toBeNull();
  expect(await paper("https://example.org", "ABCD2345")).toBeNull();
});

it("answers a community that asks with its credential, link by link in order, and no one else", async () => {
  const { t, created, clerkUserId } = await createReadySetupFixture("paper_links_http");
  const libraryId = created.libraryId;
  const token = "els_" + "c".repeat(43);
  const origin = await t.run(async (ctx) => {
    // The community's machine credential, as its setup stored one: its digest is this token's.
    const credential = await ctx.db.query("evidenceLibraryCredentials").withIndex("by_libraryId_and_credentialKey", (q) => q.eq("libraryId", libraryId).eq("credentialKey", "library-service")).unique();
    const digest = createHash("sha256").update(token).digest("hex");
    if (credential) await ctx.db.patch("evidenceLibraryCredentials", credential._id, { credentialDigest: digest });
    else await ctx.db.insert("evidenceLibraryCredentials", { libraryId, credentialKey: "library-service", encryptedValue: "unused", credentialDigest: digest, validationState: "valid", createdByClerkUserId: clerkUserId, updatedByClerkUserId: clerkUserId, createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("topicLocations", { libraryId, generation: 1, publishedRevision: 1, topicIds: [], metadata: null, groupKey: "g", itemKey: "ABCD2345", state: "published", openalexId: "W1", doi: null });
    return (await ctx.db.query("evidenceLibraryRuntimeBindings").withIndex("by_libraryId", (q) => q.eq("libraryId", libraryId)).first())!.targetBaseUrl;
  });
  const ask = (links: string[], credential = token) =>
    t.fetch("/api/v1/evidence-libraries/papers/resolve", { method: "POST", headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" }, body: JSON.stringify({ contractVersion: 1, libraryId, links }) });
  const answered = await ask([`${origin}/lib/ABCD2345`, "https://example.org/nothing", "https://doi.org/10.1000/Two"]);
  expect(answered.status).toBe(200);
  expect(await answered.json()).toEqual({ papers: [{ openalexId: "W1", doi: null }, null, { openalexId: null, doi: "10.1000/two" }] });
  expect((await ask(["W1"], "els_" + "d".repeat(43))).status).toBe(401);
});
