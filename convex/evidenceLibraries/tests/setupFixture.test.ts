import { convexTest } from "convex-test";
import { api } from "../../_generated/api";
import schema from "../../schema";

const modules = import.meta.glob("/convex/**/*.ts");

export const essentialSetupSections = {
  identity: {
    name: "Climate Evidence",
    shortName: "Climate",
    baseUrl: "https://climate-evidence-lib.libraries.example.test",
    assets: {
      logoDark: "https://assets.example.test/logo.svg",
      favicon: "https://assets.example.test/favicon.ico",
    },
  },
  theme: { colors: { accent: "#005A9C", tertiary: "#F2A900" } },
  localization: { locales: ["en-GB"], defaultLocale: "en-GB" },
};

export async function createActivatedSetupFixture(suffix: string) {
  const t = convexTest(schema, modules);
  const clerkOrganizationId = `org_${suffix}`;
  const clerkUserId = `user_${suffix}`;
  await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      clerkOrganizationId,
      name: `Team ${suffix}`,
      slug: `team-${suffix}`,
      state: "active",
      clerkCreatedAt: 1,
      clerkUpdatedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("organizationMemberships", {
      organizationId,
      clerkMembershipId: `orgmem_${suffix}`,
      clerkUserId,
      role: "org:admin",
      state: "active",
      clerkCreatedAt: 1,
      clerkUpdatedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
  });
  const admin = t.withIdentity({
    subject: clerkUserId,
    o: { id: clerkOrganizationId, rol: "org:admin" },
  });
  const created = await admin.mutation(
    api.evidenceLibraries.mutations.createSetupDraft,
    { name: essentialSetupSections.identity.name },
  );
  const saved = await admin.mutation(
    api.evidenceLibraries.mutations.saveEssentialConfiguration,
    {
      libraryId: created.libraryId,
      sections: essentialSetupSections,
      expectedEditVersion: 0,
    },
  );
  const activated = await admin.mutation(
    api.evidenceLibraries.mutations.activateConfiguration,
    {
      libraryId: created.libraryId,
      expectedEditVersion: saved.editVersion,
    },
  );
  return { activated, admin, created, t };
}
