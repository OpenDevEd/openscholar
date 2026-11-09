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
