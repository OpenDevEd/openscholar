// The Evidence Libraries a person reads (plans/evidence-library-sources).
import { expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import { createReadySetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";

it("lists the libraries a person signed in to and the ones their organization runs, once each, with how each is theirs", async () => {
  const { t, admin, created, clerkUserId } = await createReadySetupFixture("readers");
  const libraryId = created.libraryId;
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { clerkId: "user_reader", email: "reader@example.org", state: "active", createdAt: 1, updatedAt: 1 });
  });
  const seen = (clerk: string, credentialDigest = "machine-digest") => t.mutation(internal.evidenceLibraries.readers.seen, { libraryId, clerkUserId: clerk, credentialDigest });
  const reader = t.withIdentity({ subject: "user_reader" });

  // Only the library's own credential says who signed in to it.
  await expect(seen("user_reader", "another-digest")).rejects.toThrow(/credential/);
  expect(await reader.query(api.evidenceLibraries.readers.list, {})).toEqual([]);
  await seen("user_reader");
  // An account OpenScholar doesn't know is passed over.
  await seen("user_nobody");
  const [listed] = await reader.query(api.evidenceLibraries.readers.list, {});
  expect(listed).toMatchObject({ libraryId, ways: ["signIn"] });
  expect(listed!.address).toMatch(/^https:\/\//);
  expect(await t.run((ctx) => ctx.db.query("evidenceLibraryReaders").collect())).toHaveLength(1);

  // Its organization's admin has it by their role, and once they sign in to it, by both.
  expect((await admin.query(api.evidenceLibraries.readers.list, {})).map(({ libraryId: id, ways }) => [id, ways])).toEqual([[libraryId, ["role"]]]);
  await seen(clerkUserId);
  expect((await admin.query(api.evidenceLibraries.readers.list, {})).map(({ ways }) => ways.toSorted())).toEqual([["role", "signIn"]]);

  // A library turned off is nobody's to read.
  await t.run((ctx) => ctx.db.patch("evidenceLibraries", libraryId, { state: "disabled" }));
  expect(await reader.query(api.evidenceLibraries.readers.list, {})).toEqual([]);
});
