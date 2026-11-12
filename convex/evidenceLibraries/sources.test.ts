import { expect, it } from "vitest";
import { api } from "../_generated/api";
import { createReadySetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";

// The sign-out page goes back to the address a link names only when this says a community answers there: a wrong
// yes would send someone signing out to any site.
it("says a community answers at its own address and at a domain it serves, and nowhere else", async () => {
  const { t, created, clerkUserId } = await createReadySetupFixture("sign_out_return");
  const libraryId = created.libraryId;
  const origin = await t.run(async (ctx) => {
    const domain = { libraryId, verificationToken: "token", verificationHost: "example.org", state: "added" as const, generation: 0, createdByClerkUserId: clerkUserId, createdAt: 1, updatedAt: 1 };
    await ctx.db.insert("evidenceLibraryDomains", { ...domain, host: "climate.example.org", role: "primary", attachedAt: 1 });
    // A domain claimed but not yet served could be anyone's.
    await ctx.db.insert("evidenceLibraryDomains", { ...domain, host: "pending.example.org", role: "redirect" });
    return (await ctx.db.query("evidenceLibraryRuntimeBindings").withIndex("by_libraryId", (q) => q.eq("libraryId", libraryId)).first())!.targetBaseUrl;
  });
  const answers = (at: string) => t.query(api.evidenceLibraries.sources.isCommunity, { origin: at });
  expect(await answers(origin)).toBe(true);
  expect(await answers("https://climate.example.org")).toBe(true);
  expect(await answers("https://pending.example.org")).toBe(false);
  expect(await answers("https://example.org")).toBe(false);
  expect(await answers(`${origin}.example.org`)).toBe(false);
  expect(await answers("not an address")).toBe(false);
});
