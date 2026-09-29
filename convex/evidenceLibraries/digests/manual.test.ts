import { afterEach, expect, test, vi } from "vitest";
import { api } from "../../_generated/api";
import { createReadySetupFixture } from "../../../tests/helpers/evidence-library-setup-fixture";
import { encrypt } from "../../lib/crypto";
import { parseClerkProjectionEvent } from "../../webhooks/clerk_mappers";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

test.each([true, false, "true", undefined])("only the boolean dev metadata flag enables manual digests: %s", dev => {
  const event = parseClerkProjectionEvent("organization.updated", {
    id: "org-dev", name: "Dev", slug: "dev", created_at: 1, updated_at: 2,
    public_metadata: { dev },
  });
  expect(event).toMatchObject({ organization: { devEnabled: dev === true } });
});

test("requires the library owner's own organization dev flag before calling its runtime", async () => {
  vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
  const f = await createReadySetupFixture("manual_digest");
  const libraryId = f.created.libraryId;
  const args = {libraryId};
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({status: "queued", editionId: "5e9558ce-ed55-4dc4-a44b-d1cbd3f9af64", publicationCount: 2}, {status: 202}));
  vi.stubGlobal("fetch", fetch);
  vi.stubEnv("ENCRYPTION_KEY", "44".repeat(32));
  expect(await f.admin.query(api.evidenceLibraries.digests.manual.available, args)).toBe(false);
  await expect(f.admin.action(api.evidenceLibraries.digests.manualActions.send, args)).rejects.toThrow("Manual digests are not enabled");
  expect(fetch).not.toHaveBeenCalled();
  await f.t.run(async ctx => {
    await ctx.db.patch("organizations", f.organizationId, {devEnabled: true});
    const credential = await ctx.db.query("evidenceLibraryCredentials").withIndex("by_libraryId_and_credentialKey", q => q.eq("libraryId", libraryId).eq("credentialKey", "library-service")).unique();
    await ctx.db.patch("evidenceLibraryCredentials", credential!._id, {encryptedValue: encrypt("library-machine-token", "44".repeat(32))});
  });
  expect(await f.admin.query(api.evidenceLibraries.digests.manual.available, args)).toBe(true);
  expect(await f.admin.action(api.evidenceLibraries.digests.manualActions.send, args)).toEqual({status: "queued", editionId: "5e9558ce-ed55-4dc4-a44b-d1cbd3f9af64", publicationCount: 2});
  expect(fetch).toHaveBeenCalledWith(new URL("https://climate-evidence-lib.libraries.example.test/api/v1/openscholar/digests"), expect.objectContaining({method: "POST", headers: {Authorization: "Bearer library-machine-token", accept: "application/json", cookie: "ode_browser_check=1"}, redirect: "error"}));
  fetch.mockClear();
  await f.t.run(ctx => ctx.db.patch("organizationMemberships", f.membershipId, {role: "org:member"}));
  expect(await f.admin.query(api.evidenceLibraries.digests.manual.available, args)).toBe(false);
  await expect(f.admin.action(api.evidenceLibraries.digests.manualActions.send, args)).rejects.toThrow("access denied");
  await expect(f.t.action(api.evidenceLibraries.digests.manualActions.send, args)).rejects.toThrow("Sign in");
  expect(fetch).not.toHaveBeenCalled();
});
