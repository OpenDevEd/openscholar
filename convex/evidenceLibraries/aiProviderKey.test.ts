/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import {
  AI_MODELS,
  AI_PROVIDER,
  AI_PROVIDER_CREDENTIAL_KEY,
  AI_PROVIDER_KEY_PATH,
} from "../../lib/evidence-libraries/configuration/ai";
import { encrypt } from "../lib/crypto";
import {
  createActivatedSetupFixture,
  essentialSetupSections,
  toSectionRows,
} from "../../tests/helpers/evidence-library-setup-fixture";
import { readLibraryAiProviderKey } from "./aiProviderKey";
import { assembleEvidenceLibraryRuntimePayload } from "./runtimeConfiguration";

const ENCRYPTION_KEY = "44".repeat(32);
const OPENROUTER_KEY = `sk-or-v1-${"9".repeat(48)}`;

describe("the OpenRouter key", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is stored encrypted, shown only as a row, and removed on request", async () => {
    vi.stubEnv("ENCRYPTION_KEY", ENCRYPTION_KEY);
    const fixture = await createActivatedSetupFixture("ai_key_store");
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
      await fixture.admin.query(
        api.evidenceLibraries.credentials.listCredentialMetadata,
        { libraryId },
      ),
    ).toEqual([]);
  });

  it("cannot be removed when the library has none", async () => {
    const fixture = await createActivatedSetupFixture("ai_key_absent");
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
      const fixture = await createActivatedSetupFixture("ai_key_assemble");
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
