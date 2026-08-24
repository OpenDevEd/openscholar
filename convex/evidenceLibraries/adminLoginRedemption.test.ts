/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("/convex/**/*.ts");
const encryptionKey = "ab".repeat(32);
const redemptionPath = "/api/evidence-libraries/admin-login/redeem";

async function seedRedemptionScenario() {
  const t = convexTest(schema, modules);
  const seeded = await t.run(async (ctx) => {
    const organizationId = await ctx.db.insert("organizations", {
      clerkOrganizationId: "org_admin_login_redemption",
      name: "Admin Login Redemption Team",
      slug: "admin-login-redemption-team",
      state: "active",
      clerkCreatedAt: 1,
      clerkUpdatedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const membershipId = await ctx.db.insert("organizationMemberships", {
      organizationId,
      clerkMembershipId: "orgmem_admin_login_redemption",
      clerkUserId: "user_admin_login_redemption",
      role: "org:admin",
      state: "active",
      clerkCreatedAt: 1,
      clerkUpdatedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const libraryId = await ctx.db.insert("evidenceLibraries", {
      organizationId,
      name: "Admin Login Redemption Library",
      slug: "admin-login-redemption-library",
      state: "active",
      createdByClerkUserId: "user_admin_login_redemption",
      updatedByClerkUserId: "user_admin_login_redemption",
      createdAt: 1,
      updatedAt: 1,
    });
    return { libraryId, membershipId, organizationId };
  });
  const owner = t.withIdentity({
    subject: "user_admin_login_redemption",
    o: { id: "org_admin_login_redemption", rol: "org:admin" },
  });
  return { owner, t, ...seeded };
}

async function issueRedemptionPair(
  owner: Awaited<ReturnType<typeof seedRedemptionScenario>>["owner"],
  libraryId: Awaited<ReturnType<typeof seedRedemptionScenario>>["libraryId"],
) {
  const machineCredential = await owner.action(
    api.evidenceLibraries.credentialActions.rotateServiceCredential,
    { libraryId },
  );
  const loginCode = await owner.action(
    api.evidenceLibraries.adminLoginCodeActions.issueAdminLoginCode,
    { libraryId },
  );
  return { loginCode, machineCredential };
}

function redeem(
  t: Awaited<ReturnType<typeof seedRedemptionScenario>>["t"],
  args: { libraryId: string; machineCredential: string; code: string },
) {
  return t.fetch(redemptionPath, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.machineCredential}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ libraryId: args.libraryId, code: args.code }),
  });
}

describe("Evidence Library admin login redemption", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("authenticates the library, consumes one code, and returns bound session details", async () => {
    vi.stubEnv("ENCRYPTION_KEY", encryptionKey);
    const { libraryId, organizationId, owner, t } =
      await seedRedemptionScenario();
    const { loginCode, machineCredential } = await issueRedemptionPair(
      owner,
      libraryId,
    );

    const response = await redeem(t, {
      libraryId,
      machineCredential: machineCredential.credential,
      code: loginCode.code,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      libraryId,
      clerkUserId: "user_admin_login_redemption",
      clerkOrganizationId: "org_admin_login_redemption",
      role: "owner",
      consumedAt: expect.any(Number),
    });
    expect(JSON.stringify(body)).not.toContain(machineCredential.credential);
    expect(JSON.stringify(body)).not.toContain(loginCode.code);

    const codeRows = await t.run(async (ctx) =>
      ctx.db
        .query("evidenceLibraryAdminLoginCodes")
        .withIndex("by_libraryId_and_codeDigest", (query) =>
          query
            .eq("libraryId", libraryId)
            .eq(
              "codeDigest",
              createHash("sha256").update(loginCode.code).digest("hex"),
            ),
        )
        .take(2),
    );
    expect(codeRows).toEqual([
      expect.objectContaining({ consumedAt: body.consumedAt }),
    ]);

    const auditRows = await t.run(async (ctx) =>
      ctx.db
        .query("auditLogs")
        .withIndex("by_action", (query) =>
          query.eq("action", "evidence_library.admin_login_code.redeemed"),
        )
        .take(2),
    );
    expect(auditRows).toEqual([
      expect.objectContaining({
        userId: "user_admin_login_redemption",
        metadata: {
          codeId: codeRows[0]._id,
          credentialId: machineCredential.credentialId,
          libraryId,
          organizationId,
          role: "owner",
        },
      }),
    ]);
  });
});
