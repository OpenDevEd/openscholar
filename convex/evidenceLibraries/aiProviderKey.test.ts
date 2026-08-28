/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import {
  AI_PROVIDER_CREDENTIAL_KEY,
  AI_PROVIDER_KEY_PATH,
} from "../../lib/evidence-libraries/configuration/ai";
import { readLibraryAiProviderKey } from "./aiProviderKey";

const OPENROUTER_KEY = `sk-or-v1-${"9".repeat(48)}`;

async function libraryWithOwner() {
  const t = convexTest(schema);
  const libraryId = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      clerkOrganizationId: "org_ai_key",
      name: "AI Key Team",
      slug: "ai-key-team",
      state: "active",
      clerkCreatedAt: 1,
      clerkUpdatedAt: 1,
      createdAt: 1,
      updatedAt: 1,
      evidenceLibrariesEnabled: true,
    });
    await ctx.db.insert("organizationMemberships", {
      organizationId,
      clerkMembershipId: "orgmem_ai_key",
      clerkUserId: "user_ai_key",
      role: "org:admin",
      state: "active",
      clerkCreatedAt: 1,
      clerkUpdatedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    return await ctx.db.insert("evidenceLibraries", {
      organizationId,
      name: "AI Key Library",
      slug: "ai-key-library",
      state: "active",
      createdByClerkUserId: "user_ai_key",
      updatedByClerkUserId: "user_ai_key",
      createdAt: 1,
      updatedAt: 1,
    });
  });
  const owner = t.withIdentity({
    subject: "user_ai_key",
    o: { id: "org_ai_key", rol: "org:admin" },
  });
  return { t, owner, libraryId };
}

describe("the OpenRouter key", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is stored encrypted, shown only as a hint, and removed on request", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "ab".repeat(32));
    const { owner, libraryId } = await libraryWithOwner();

    await owner.action(api.evidenceLibraries.credentialActions.writeCredential, {
      libraryId,
      concretePath: AI_PROVIDER_KEY_PATH,
      instanceKey: "openrouter",
      value: OPENROUTER_KEY,
    });

    const metadata = await owner.query(
      api.evidenceLibraries.credentials.listCredentialMetadata,
      { libraryId },
    );
    expect(metadata).toEqual([
      expect.objectContaining({
        credentialKey: AI_PROVIDER_CREDENTIAL_KEY,
        pathPattern: "/ai/providers/*/apiKey",
      }),
    ]);
    // Nothing the page can read carries the key itself.
    expect(JSON.stringify(metadata)).not.toContain(OPENROUTER_KEY);

    const stored = await owner.run((ctx) =>
      readLibraryAiProviderKey(ctx, libraryId),
    );
    expect(stored?.encryptedApiKey).toBeTypeOf("string");
    expect(stored?.encryptedApiKey).not.toContain(OPENROUTER_KEY);

    await owner.mutation(
      api.evidenceLibraries.aiProviderKey.removeAiProviderKey,
      { libraryId },
    );
    // `run` turns the helper's `undefined` into `null` on the way back.
    expect(
      await owner.run((ctx) => readLibraryAiProviderKey(ctx, libraryId)),
    ).toBeFalsy();
    expect(
      await owner.query(
        api.evidenceLibraries.credentials.listCredentialMetadata,
        { libraryId },
      ),
    ).toEqual([]);
  });

  it("cannot be removed when the library has none", async () => {
    const { owner, libraryId } = await libraryWithOwner();
    await expect(
      owner.mutation(api.evidenceLibraries.aiProviderKey.removeAiProviderKey, {
        libraryId,
      }),
    ).rejects.toThrow(/no AI key/);
  });
});
