/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import {
  AI_MODELS,
  AI_PROVIDER,
  AI_PROVIDER_CREDENTIAL_KEY,
  AI_PROVIDER_KEY_PATH,
} from "../../lib/evidence-libraries/configuration/ai";
import { decrypt, encrypt } from "../lib/crypto";
import {
  createActivatedSetupFixture,
  createDraftSetupFixture,
  createReadySetupFixture,
  essentialSetupSections,
  toSectionRows,
} from "../../tests/helpers/evidence-library-setup-fixture";
import {
  readAiProviderKeySource,
  readLibraryAiProviderKey,
  requireUnchangedAiProviderKey,
} from "./aiProviderKey";
import { assembleEvidenceLibraryRuntimePayload } from "./runtimeConfiguration";

const ENCRYPTION_KEY = "44".repeat(32);
const OPENROUTER_KEY = `sk-or-v1-${"9".repeat(48)}`;

describe("the OpenRouter key", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is stored encrypted, shown only as a row, and removed on request", async () => {
    vi.stubEnv("ENCRYPTION_KEY", ENCRYPTION_KEY);
    const fixture = await createReadySetupFixture("ai_key_store");
    const libraryId = fixture.created.libraryId;

    await fixture.admin.action(
      api.evidenceLibraries.credentialActions.writeCredential,
      {
        libraryId,
        concretePath: AI_PROVIDER_KEY_PATH,
        instanceKey: AI_PROVIDER,
        value: OPENROUTER_KEY,
      },
    );

    const metadata = await fixture.admin.query(
      api.evidenceLibraries.credentials.listCredentialMetadata,
      { libraryId },
    );
    expect(
      metadata.filter(
        (row) => row.credentialKey === AI_PROVIDER_CREDENTIAL_KEY,
      ),
    ).toEqual([
      expect.objectContaining({ pathPattern: "/ai/providers/*/apiKey" }),
    ]);
    // Nothing the page can read carries the key itself.
    expect(JSON.stringify(metadata)).not.toContain(OPENROUTER_KEY);
    const draft = await fixture.admin.query(
      api.evidenceLibraries.queries.getDraft,
      { libraryId },
    );
    expect(JSON.stringify(draft)).not.toContain(OPENROUTER_KEY);

    const stored = await fixture.t.run((ctx) =>
      readLibraryAiProviderKey(ctx, libraryId),
    );
    expect(stored?.encryptedApiKey).toBeTypeOf("string");
    expect(stored?.encryptedApiKey).not.toContain(OPENROUTER_KEY);

    await fixture.admin.mutation(
      api.evidenceLibraries.aiProviderKey.removeAiProviderKey,
      { libraryId },
    );
    // `run` turns the helper's `undefined` into `null` on the way back.
    expect(
      await fixture.t.run((ctx) => readLibraryAiProviderKey(ctx, libraryId)),
    ).toBeFalsy();
    expect(
      (
        await fixture.admin.query(
          api.evidenceLibraries.credentials.listCredentialMetadata,
          { libraryId },
        )
      ).filter((row) => row.credentialKey === AI_PROVIDER_CREDENTIAL_KEY),
    ).toEqual([]);
  });

  it("keeps one row when the owner replaces the key", async () => {
    vi.stubEnv("ENCRYPTION_KEY", ENCRYPTION_KEY);
    const fixture = await createReadySetupFixture("ai_key_replace");
    const libraryId = fixture.created.libraryId;
    const replacement = `sk-or-v1-${"1".repeat(48)}`;

    for (const value of [OPENROUTER_KEY, replacement]) {
      await fixture.admin.action(
        api.evidenceLibraries.credentialActions.writeCredential,
        {
          libraryId,
          concretePath: AI_PROVIDER_KEY_PATH,
          instanceKey: AI_PROVIDER,
          value,
        },
      );
    }

    const rows = await fixture.t.run(async (ctx) =>
      (
        await ctx.db
          .query("evidenceLibraryCredentials")
          .withIndex("by_libraryId", (query) => query.eq("libraryId", libraryId))
          .collect()
      ).filter((row) => row.credentialKey === AI_PROVIDER_CREDENTIAL_KEY),
    );
    expect(rows).toHaveLength(1);
    // The row now holds the new key, and the old one is gone for good.
    expect(decrypt(rows[0]!.encryptedValue, ENCRYPTION_KEY)).toBe(replacement);
  });

  it("stops a publish that read a key which has since changed", async () => {
    vi.stubEnv("ENCRYPTION_KEY", ENCRYPTION_KEY);
    const fixture = await createReadySetupFixture("ai_key_race");
    const libraryId = fixture.created.libraryId;
    const write = (value: string) =>
      fixture.admin.action(
        api.evidenceLibraries.credentialActions.writeCredential,
        {
          libraryId,
          concretePath: AI_PROVIDER_KEY_PATH,
          instanceKey: AI_PROVIDER,
          value,
        },
      );
    await write(OPENROUTER_KEY);

    // What a publish would have read before the owner touched the key again.
    const seen = await fixture.t.run((ctx) =>
      readAiProviderKeySource(ctx, libraryId),
    );
    await write(`sk-or-v1-${"2".repeat(48)}`);
    await expect(
      fixture.t.run((ctx) =>
        requireUnchangedAiProviderKey(ctx, libraryId, seen),
      ),
    ).rejects.toThrow(/changed while the library was publishing/);

    // Removing it counts as a change too.
    const afterReplace = await fixture.t.run((ctx) =>
      readAiProviderKeySource(ctx, libraryId),
    );
    await fixture.admin.mutation(
      api.evidenceLibraries.aiProviderKey.removeAiProviderKey,
      { libraryId },
    );
    await expect(
      fixture.t.run((ctx) =>
        requireUnchangedAiProviderKey(ctx, libraryId, afterReplace),
      ),
    ).rejects.toThrow(/changed while the library was publishing/);

    // An untouched key passes.
    await write(OPENROUTER_KEY);
    const steady = await fixture.t.run((ctx) =>
      readAiProviderKeySource(ctx, libraryId),
    );
    await expect(
      fixture.t.run((ctx) =>
        requireUnchangedAiProviderKey(ctx, libraryId, steady),
      ),
    ).resolves.toBeNull();
  });

  it.each([
    [
      "another vendor",
      { providers: [{ provider: "openai", enabled: true, defaultModel: "gpt-5.4" }] },
      true,
    ],
    [
      "two providers",
      {
        providers: [
          { provider: AI_PROVIDER, enabled: true, defaultModel: AI_MODELS[0] },
          { provider: AI_PROVIDER, enabled: false },
        ],
      },
      true,
    ],
    [
      "no model",
      { providers: [{ provider: AI_PROVIDER, enabled: true }] },
      true,
    ],
    [
      "a model the runtime does not offer",
      {
        providers: [
          { provider: AI_PROVIDER, enabled: true, defaultModel: "made-up/model" },
        ],
      },
      true,
    ],
    [
      "a saved AI row with no provider",
      { providers: [] },
      false,
    ],
    [
      "a provider switched on while AI answers are off",
      {
        providers: [
          { provider: AI_PROVIDER, enabled: true, defaultModel: AI_MODELS[0] },
        ],
      },
      false,
    ],
  ])("refuses to save %s", async (name, ai, featuresAi) => {
    const fixture = await createReadySetupFixture(
      `ai_save_${name.replace(/\W+/gu, "_")}`,
    );
    await expect(
      fixture.admin.mutation(
        api.evidenceLibraries.mutations.saveDraftSections,
        {
          libraryId: fixture.created.libraryId,
          sections: toSectionRows({ ai, features: { ai: featuresAi } }),
          expectedEditVersion: fixture.activated.editVersion,
        },
      ),
    ).rejects.toThrow();
  });

  it("saves one OpenRouter entry with an approved model", async () => {
    const fixture = await createReadySetupFixture("ai_save_good");
    const ai = {
      providers: [
        { provider: AI_PROVIDER, enabled: true, defaultModel: AI_MODELS[0] },
      ],
    };
    await fixture.admin.mutation(
      api.evidenceLibraries.mutations.saveDraftSections,
      {
        libraryId: fixture.created.libraryId,
        sections: toSectionRows({ ai, features: { ai: true } }),
        expectedEditVersion: fixture.activated.editVersion,
      },
    );
    const draft = await fixture.admin.query(
      api.evidenceLibraries.queries.getDraft,
      { libraryId: fixture.created.libraryId },
    );
    expect(
      draft.sections.find((row) => row.sectionKey === "ai")?.payload,
    ).toEqual(ai);
  });

  it("never reaches the browser, not even as ciphertext", async () => {
    vi.stubEnv("ENCRYPTION_KEY", ENCRYPTION_KEY);
    const fixture = await createReadySetupFixture("ai_key_projection");
    const libraryId = fixture.created.libraryId;
    await fixture.admin.action(
      api.evidenceLibraries.credentialActions.writeCredential,
      {
        libraryId,
        concretePath: AI_PROVIDER_KEY_PATH,
        instanceKey: AI_PROVIDER,
        value: OPENROUTER_KEY,
      },
    );
    const ciphertext = (await fixture.t.run((ctx) =>
      readAiProviderKeySource(ctx, libraryId),
    ))!;
    const encryptedRuntimeConfig = encrypt('{"secret":"x"}', ENCRYPTION_KEY);

    // A publish that has saved its target: the operation now holds the
    // library's whole encrypted configuration.
    await fixture.t.run(async (ctx) => {
      const operation = await ctx.db
        .query("evidenceLibraryConfigOperations")
        .withIndex("by_libraryId_and_createdAt", (query) =>
          query.eq("libraryId", libraryId),
        )
        .order("desc")
        .first();
      await ctx.db.patch(operation!._id, {
        configurationDeploymentTarget: {
          applicationId: "coolify-application-1",
          aiProviderKey: ciphertext,
          runtimeBindingId: fixture.created.runtimeBindingId,
          targetBaseUrl: "https://climate-evidence-lib.libraries.example.test",
          revisionKey: "r2",
          defaultLocale: "en-GB",
          runtimeCommit: "a".repeat(40),
          encryptedRuntimeConfig,
          runtimeConfigSha256: "b".repeat(64),
          savedAt: 1,
        },
      });
    });

    const draft = await fixture.admin.query(
      api.evidenceLibraries.queries.getDraft,
      { libraryId },
    );
    const seen = JSON.stringify(draft);
    expect(seen).not.toContain(encryptedRuntimeConfig);
    expect(seen).not.toContain(OPENROUTER_KEY);
    for (const secret of Object.values(
      await fixture.t.run(async (ctx) =>
        (
          await ctx.db
            .query("evidenceLibraryCredentials")
            .withIndex("by_libraryId", (query) => query.eq("libraryId", libraryId))
            .collect()
        ).map((row) => row.encryptedValue),
      ),
    )) {
      expect(seen).not.toContain(secret);
    }
    expect(draft.operation).not.toHaveProperty("configurationDeploymentTarget");
  });

  it("cannot be replaced or removed while the library is publishing", async () => {
    vi.stubEnv("ENCRYPTION_KEY", ENCRYPTION_KEY);
    const fixture = await createActivatedSetupFixture("ai_key_busy");
    const libraryId = fixture.created.libraryId;
    // The fixture's setup operation is still running.
    await expect(
      fixture.admin.action(
        api.evidenceLibraries.credentialActions.writeCredential,
        {
          libraryId,
          concretePath: AI_PROVIDER_KEY_PATH,
          instanceKey: AI_PROVIDER,
          value: OPENROUTER_KEY,
        },
      ),
    ).rejects.toThrow(/Wait for the current publish to finish/);
    await expect(
      fixture.admin.mutation(
        api.evidenceLibraries.aiProviderKey.removeAiProviderKey,
        { libraryId },
      ),
    ).rejects.toThrow(/Wait for the current publish to finish/);
  });

  it("can be stored on a library that has not been set up yet", async () => {
    vi.stubEnv("ENCRYPTION_KEY", ENCRYPTION_KEY);
    // A new library's setup operation is queued and waiting for the owner,
    // so the key can still be added before the first setup runs.
    const fixture = await createDraftSetupFixture("ai_key_draft");
    await expect(
      fixture.admin.action(
        api.evidenceLibraries.credentialActions.writeCredential,
        {
          libraryId: fixture.created.libraryId,
          concretePath: AI_PROVIDER_KEY_PATH,
          instanceKey: AI_PROVIDER,
          value: OPENROUTER_KEY,
        },
      ),
    ).resolves.toBeTruthy();
  });

  it("cannot be removed when the library has none", async () => {
    const fixture = await createReadySetupFixture("ai_key_absent");
    await expect(
      fixture.admin.mutation(
        api.evidenceLibraries.aiProviderKey.removeAiProviderKey,
        { libraryId: fixture.created.libraryId },
      ),
    ).rejects.toThrow(/no AI key/);
  });

  it(
    "reaches the runtime only when the configuration payload is built",
    async () => {
      vi.stubEnv("ENCRYPTION_KEY", ENCRYPTION_KEY);
      const fixture = await createReadySetupFixture("ai_key_assemble");
      const libraryId = fixture.created.libraryId;
      await fixture.admin.action(
        api.evidenceLibraries.credentialActions.writeCredential,
        {
          libraryId,
          concretePath: AI_PROVIDER_KEY_PATH,
          instanceKey: AI_PROVIDER,
          value: OPENROUTER_KEY,
        },
      );

      const ai = {
        providers: [
          {
            provider: AI_PROVIDER,
            enabled: true,
            defaultModel: AI_MODELS[0],
          },
        ],
      };
      const features = { ai: true };
      await fixture.admin.mutation(
        api.evidenceLibraries.mutations.saveDraftSections,
        {
          libraryId,
          sections: toSectionRows({ ai, features }),
          expectedEditVersion: fixture.activated.editVersion,
        },
      );
      const draft = await fixture.admin.query(
        api.evidenceLibraries.queries.getDraft,
        { libraryId },
      );
      expect(
        draft.sections.find((row) => row.sectionKey === "ai")?.payload,
      ).toEqual(ai);
      expect(JSON.stringify(draft)).not.toContain(OPENROUTER_KEY);

      const aiProviderKey = await fixture.t.run((ctx) =>
        readLibraryAiProviderKey(ctx, libraryId),
      );
      const payload = assembleEvidenceLibraryRuntimePayload({
        encryptionKey: ENCRYPTION_KEY,
        libraryId,
        revision: { key: "r2", createdAt: 10 },
        origins: {
          app: "https://openscholar.example.test",
          convexSite: "https://convex.example.test",
        },
        sections: { ...essentialSetupSections, ai, features },
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
        zoteroGroups: [],
        aiProviderKey: aiProviderKey ?? undefined,
      });
      expect(payload.runtimeConfig.ai).toEqual({
        providers: [
          {
            provider: AI_PROVIDER,
            enabled: true,
            defaultModel: AI_MODELS[0],
            apiKey: OPENROUTER_KEY,
          },
        ],
        prompts: {},
      });
    },
  );
});
