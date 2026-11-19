import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import { createDraftSetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";
import { buildPublicationConfiguration } from "../../lib/evidence-libraries/configuration/publication";
import { EMPTY_PUBLICATION_SETTINGS } from "../../lib/evidence-libraries/configuration/publication-settings";
import { decrypt } from "../lib/crypto";
import {
  readPublicationProviderRecord,
  readPublicationProviderSource,
  requireUnchangedPublicationProviders,
  hasPublicationProviderChanges,
} from "./publicationProviders";

const key = "44".repeat(32);
beforeEach(() => vi.stubEnv("ENCRYPTION_KEY", key));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const customZenodo = () => ({
  ...structuredClone(EMPTY_PUBLICATION_SETTINGS),
  zenodo: { ...EMPTY_PUBLICATION_SETTINGS.zenodo, mode: "custom" as const },
});
function providerResponses(crossrefValid = true) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/servlet/login")
      return Response.json({
        authenticated: crossrefValid,
        authorised: crossrefValid,
      });
    // Crossref's public record of who a prefix is registered to: it has 10.12345 and no other.
    if (url.pathname.startsWith("/prefixes/"))
      return url.pathname.endsWith("/10.12345") ? Response.json({ message: { name: "Open Development and Education Limited" } }) : new Response("Resource not found.", { status: 404 });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    if (url.pathname.endsWith("/actions/edit"))
      return Response.json(
        { status: 400, message: "Not a published deposition." },
        { status: 400 },
      );
    return Response.json({ id: 42 }, { status: 201 });
  });
}

test("saves only verified credentials, keeps them private, and assembles the runtime configuration", async () => {
  const fixture = await createDraftSetupFixture("publication_settings");
  const libraryId = fixture.created.libraryId;
  const fetch = providerResponses();
  vi.stubGlobal("fetch", fetch);
  await fixture.admin.action(
    api.evidenceLibraries.publicationProviderActions.verifyAndSave,
    {
      libraryId,
      settings: customZenodo(),
      credentials: { zenodoToken: "valid-token" },
      expectedUpdatedAt: null,
    },
  );
  expect(
    fetch.mock.calls.map(([url, init]) => [
      new URL(String(url)).pathname,
      init?.method,
    ]),
  ).toEqual([
    ["/api/deposit/depositions", "POST"],
    ["/api/deposit/depositions/42/actions/edit", "POST"],
    ["/api/deposit/depositions/42", "DELETE"],
  ]);
  const visible = await fixture.admin.query(
    api.evidenceLibraries.publicationProviders.get,
    { libraryId },
  );
  expect(visible.settings.zenodo.mode).toBe("custom");
  expect(JSON.stringify(visible)).not.toContain("valid-token");
  const stored = await fixture.t.run((ctx) =>
    readPublicationProviderRecord(ctx, libraryId),
  );
  expect(
    buildPublicationConfiguration(
      stored!.publicationSettings!,
      JSON.parse(decrypt(stored!.encryptedValue, key)),
    ),
  ).toMatchObject({
    zenodo: { enabled: true, environment: "production", token: "valid-token" },
    crossref: { enabled: false },
  });
  const fingerprint = await fixture.t.run((ctx) =>
    readPublicationProviderSource(ctx, libraryId),
  );
  expect(
    await fixture.t.run(async (ctx) =>
      hasPublicationProviderChanges(
        ctx,
        (await ctx.db.get("evidenceLibraries", libraryId))!,
      ),
    ),
  ).toBe(true);
  await fixture.admin.action(
    api.evidenceLibraries.publicationProviderActions.verifyAndSave,
    {
      libraryId,
      settings: customZenodo(),
      credentials: {},
      expectedUpdatedAt: visible.updatedAt,
    },
  );
  await expect(
    fixture.t.run((ctx) =>
      requireUnchangedPublicationProviders(ctx, libraryId, fingerprint),
    ),
  ).resolves.toBeNull();
  const latest = await fixture.admin.query(
    api.evidenceLibraries.publicationProviders.get,
    { libraryId },
  );
  await fixture.admin.action(
    api.evidenceLibraries.publicationProviderActions.verifyAndSave,
    {
      libraryId,
      settings: {
        ...customZenodo(),
        zenodo: { ...customZenodo().zenodo, license: "cc-by-sa-4.0" },
      },
      credentials: {},
      expectedUpdatedAt: latest.updatedAt,
    },
  );
  await expect(
    fixture.t.run((ctx) =>
      requireUnchangedPublicationProviders(ctx, libraryId, fingerprint),
    ),
  ).rejects.toThrow(/CONFLICT/);
  await expect(
    fixture.admin.action(
      api.evidenceLibraries.publicationProviderActions.verifyAndSave,
      {
        libraryId,
        settings: customZenodo(),
        credentials: {},
        expectedUpdatedAt: null,
      },
    ),
  ).rejects.toThrow(/CONFLICT/);
});

test("refuses invalid tokens, a licence Zenodo doesn't take, and Crossref without Zenodo without saving anything", async () => {
  const fixture = await createDraftSetupFixture("invalid_publication");
  const libraryId = fixture.created.libraryId;
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json({ status: 403 }, { status: 403 }),
  );
  vi.stubGlobal("fetch", fetch);
  await expect(
    fixture.admin.action(
      api.evidenceLibraries.publicationProviderActions.verifyAndSave,
      {
        libraryId,
        settings: customZenodo(),
        credentials: { zenodoToken: "invalid" },
        expectedUpdatedAt: null,
      },
    ),
  ).rejects.toThrow(/deposit:write/);
  expect(
    await fixture.t.run((ctx) => readPublicationProviderRecord(ctx, libraryId)),
  ).toBeNull();
  fetch.mockClear();
  // A typo in the licence would fail every deposit later, so the save refuses it before calling Zenodo.
  await expect(
    fixture.admin.action(api.evidenceLibraries.publicationProviderActions.verifyAndSave, {
      libraryId,
      settings: { ...customZenodo(), zenodo: { ...customZenodo().zenodo, license: "cc-by-4" } },
      credentials: { zenodoToken: "valid-token" },
      expectedUpdatedAt: null,
    }),
  ).rejects.toThrow(/licence/);
  expect(fetch).not.toHaveBeenCalled();
  expect(await fixture.t.run((ctx) => readPublicationProviderRecord(ctx, libraryId))).toBeNull();
  const settings = structuredClone(EMPTY_PUBLICATION_SETTINGS);
  settings.crossref.mode = "custom";
  await expect(
    fixture.admin.action(
      api.evidenceLibraries.publicationProviderActions.verifyAndSave,
      { libraryId, settings, credentials: {}, expectedUpdatedAt: null },
    ),
  ).rejects.toThrow(/Crossref requires Zenodo/);
  expect(fetch).not.toHaveBeenCalled();
  settings.zenodo.mode = "sandbox";
  vi.stubEnv("EL_ZENODO_SANDBOX_TOKEN", "platform-token");
  await expect(
    fixture.admin.action(api.evidenceLibraries.publicationProviderActions.verifyAndSave,
      { libraryId, settings, credentials: {}, expectedUpdatedAt: null }),
  ).rejects.toThrow(/Production Crossref requires production Zenodo/);
  expect(fetch).not.toHaveBeenCalled();
});

test("uses platform sandbox accounts and rejects a failed Crossref check after cleaning the Zenodo draft", async () => {
  const env = {
    ZENODO_SANDBOX_TOKEN: "platform-zenodo",
    CROSSREF_SANDBOX_LOGIN_ID: "user@example.org/depositor",
    CROSSREF_SANDBOX_PASSWORD: "platform-password",
    CROSSREF_SANDBOX_PREFIX: "10.5555",
    CROSSREF_SANDBOX_DEPOSITOR_NAME: "OpenScholar",
    CROSSREF_SANDBOX_EMAIL: "test@example.org",
    CROSSREF_SANDBOX_REGISTRANT: "OpenScholar",
  };
  for (const [name, value] of Object.entries(env))
    vi.stubEnv(`EL_${name}`, value);
  const fixture = await createDraftSetupFixture("sandbox_publication");
  const libraryId = fixture.created.libraryId;
  const settings = structuredClone(EMPTY_PUBLICATION_SETTINGS);
  settings.zenodo.mode = "sandbox";
  settings.crossref.mode = "sandbox";
  const fetch = providerResponses(false);
  vi.stubGlobal("fetch", fetch);
  await expect(
    fixture.admin.action(
      api.evidenceLibraries.publicationProviderActions.verifyAndSave,
      { libraryId, settings, credentials: {}, expectedUpdatedAt: null },
    ),
  ).rejects.toThrow(/Crossref could not verify/);
  expect(fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(
    true,
  );
  const login = new URL(String(fetch.mock.calls.at(-1)![0]));
  expect(login.hostname).toBe("test.crossref.org");
  expect(login.searchParams.get("usr")).toBe("user@example.org");
  expect(login.searchParams.get("role")).toBe("depositor");
  expect(new URL(String(fetch.mock.calls[0][0])).hostname).toBe(
    "sandbox.zenodo.org",
  );
  expect(
    await fixture.t.run((ctx) => readPublicationProviderRecord(ctx, libraryId)),
  ).toBeNull();
});

test("keeps the own accounts through a spell on the sandbox, so switching back needs nothing typed again", async () => {
  for (const [name, value] of Object.entries({
    ZENODO_SANDBOX_TOKEN: "platform-zenodo",
    CROSSREF_SANDBOX_LOGIN_ID: "sandbox@example.org/depositor",
    CROSSREF_SANDBOX_PASSWORD: "platform-password",
    CROSSREF_SANDBOX_PREFIX: "10.5555",
    CROSSREF_SANDBOX_DEPOSITOR_NAME: "OpenScholar",
    CROSSREF_SANDBOX_EMAIL: "test@example.org",
    CROSSREF_SANDBOX_REGISTRANT: "OpenScholar",
  }))
    vi.stubEnv(`EL_${name}`, value);
  vi.stubGlobal("fetch", providerResponses());
  const fixture = await createDraftSetupFixture("kept_accounts");
  const libraryId = fixture.created.libraryId;
  const save = async (mode: "sandbox" | "custom" | "off", crossref: Partial<typeof EMPTY_PUBLICATION_SETTINGS.crossref>, credentials: Record<string, string>) => {
    const { updatedAt } = await fixture.admin.query(api.evidenceLibraries.publicationProviders.get, { libraryId });
    const settings = structuredClone(EMPTY_PUBLICATION_SETTINGS);
    settings.zenodo.mode = mode;
    settings.crossref = { ...settings.crossref, mode, ...crossref };
    await fixture.admin.action(api.evidenceLibraries.publicationProviderActions.verifyAndSave, { libraryId, settings, credentials, expectedUpdatedAt: updatedAt });
  };
  // The registrant is Crossref's word for the prefix, whatever a caller sends.
  const typed = { prefix: "10.12345", registrant: "typed by hand", depositorName: "OpenDevEd Ltd", email: "doi@opendeved.net" };
  const own = { ...typed, registrant: "Open Development and Education Limited" };
  const active = async () => {
    const stored = await fixture.t.run((ctx) => readPublicationProviderRecord(ctx, libraryId));
    return { settings: stored!.publicationSettings!, credentials: JSON.parse(decrypt(stored!.encryptedValue, key)) };
  };

  const login = { zenodoToken: "own-token", crossrefLoginId: "own@example.org/role", crossrefPassword: "own-password" };
  // A prefix Crossref doesn't have is refused on saving, not when the first deposit fails.
  await expect(save("custom", { ...typed, prefix: "10.99999" }, login)).rejects.toThrow(/no DOI prefix 10\.99999/);
  await save("custom", typed, login);
  await save("sandbox", {}, {});
  // On the sandbox, only the sandbox's accounts are in use: the runtime never carries the own ones.
  const sandbox = await active();
  expect(sandbox.credentials).toEqual({ zenodoToken: "platform-zenodo", crossrefLoginId: "sandbox@example.org/depositor", crossrefPassword: "platform-password" });
  expect(sandbox.settings.crossref.prefix).toBe("10.5555");
  // The form is told what is kept, never the secrets themselves.
  const shown = await fixture.admin.query(api.evidenceLibraries.publicationProviders.get, { libraryId });
  expect(shown.custom).toEqual({ crossref: own, zenodoToken: true, crossrefLogin: true });
  expect(JSON.stringify(shown)).not.toContain("own-password");

  // Back to the own accounts with nothing typed: they are taken up again.
  await save("custom", { prefix: "", registrant: "", depositorName: "", email: "" }, {});
  const back = await active();
  expect(back.credentials).toEqual({ zenodoToken: "own-token", crossrefLoginId: "own@example.org/role", crossrefPassword: "own-password" });
  expect(back.settings.crossref).toMatchObject(own);

  // Off forgets them: it is how an admin removes stored credentials.
  await save("off", {}, {});
  const off = await fixture.admin.query(api.evidenceLibraries.publicationProviders.get, { libraryId });
  expect(off.custom).toEqual({ crossref: null, zenodoToken: false, crossrefLogin: false });
  const stored = await fixture.t.run((ctx) => readPublicationProviderRecord(ctx, libraryId));
  expect(JSON.parse(decrypt(stored!.encryptedCustomValue!, key))).toEqual({});
});

test("builds a community archiving in its owner's own Zenodo account with no token, under its Crossref DOI, and only with its own Crossref", () => {
  const crossref = { mode: "custom" as const, prefix: "10.1234", suffixNamespace: "c", depositorName: "D", email: "d@test.local", registrant: "R" };
  const own = (mode: "custom" | "sandbox") => ({
    ...structuredClone(EMPTY_PUBLICATION_SETTINGS),
    zenodo: { ...EMPTY_PUBLICATION_SETTINGS.zenodo, mode: "own" as const, ownerUserId: "owner" as never },
    crossref: { ...crossref, mode },
  });
  const secrets = { crossrefLoginId: "login", crossrefPassword: "secret" };
  // Accepted by the runtime's contract (the builder checks it), with no token for the runtime to hold.
  const built = buildPublicationConfiguration(own("custom"), secrets);
  expect(built.zenodo).toMatchObject({ enabled: true, environment: "production", defaultIdentifierPolicy: "reuse-crossref", account: "openscholar" });
  expect(built.zenodo).not.toHaveProperty("token");
  // Test DOIs never go on real Zenodo records.
  expect(() => buildPublicationConfiguration(own("sandbox"), secrets)).toThrow(/own Crossref/);
});
