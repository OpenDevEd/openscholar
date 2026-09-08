/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { createReadySetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";

const modules = import.meta.glob("/convex/**/*.ts");
const encryptionKey = "ab".repeat(32);
const redemptionPath = "/api/v1/evidence-libraries/admin-login/redeem";

async function seedRedemptionScenario() {
  const fixture = await createReadySetupFixture("admin_login_redemption");
  const secondLibraryId = await fixture.t.run(async (ctx) => {
    const secondLibraryId = await ctx.db.insert("evidenceLibraries", {
      organizationId: fixture.organizationId,
      name: "Second Admin Login Redemption Library",
      slug: "second-admin-login-redemption-library",
      state: "active",
      createdByClerkUserId: "user_admin_login_redemption",
      updatedByClerkUserId: "user_admin_login_redemption",
      createdAt: 1,
      updatedAt: 1,
    });
    return secondLibraryId;
  });
  return {
    libraryId: fixture.created.libraryId,
    membershipId: fixture.membershipId,
    organizationId: fixture.organizationId,
    owner: fixture.admin,
    secondLibraryId,
    t: fixture.t,
  };
}

// The handoff hands back the address the browser goes to; the code the
// runtime redeems travels inside it.
async function issueLoginCode(
  caller: Awaited<ReturnType<typeof seedRedemptionScenario>>["owner"],
  libraryId: Awaited<ReturnType<typeof seedRedemptionScenario>>["libraryId"],
) {
  const handoff = await caller.action(
    api.evidenceLibraries.adminHandoffActions.issueAdminHandoff,
    { libraryId },
  );
  if (handoff.status !== "allowed") {
    throw new Error(`The admin handoff answered ${handoff.status}`);
  }
  const code = new URL(handoff.launchUrl).searchParams.get("code");
  if (!code) throw new Error("The launch address carries no code");
  return { code };
}

async function issueRedemptionPair(
  owner: Awaited<ReturnType<typeof seedRedemptionScenario>>["owner"],
  libraryId: Awaited<ReturnType<typeof seedRedemptionScenario>>["libraryId"],
) {
  const machineCredential = await owner.action(
    api.evidenceLibraries.credentialActions.rotateServiceCredential,
    { libraryId },
  );
  const loginCode = await issueLoginCode(owner, libraryId);
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

async function readCodeRow(
  t: Awaited<ReturnType<typeof seedRedemptionScenario>>["t"],
  libraryId: Id<"evidenceLibraries">,
  code: string,
) {
  const rows = await t.run(async (ctx) =>
    ctx.db
      .query("evidenceLibraryAdminLoginCodes")
      .withIndex("by_libraryId_and_codeDigest", (query) =>
        query
          .eq("libraryId", libraryId)
          .eq("codeDigest", createHash("sha256").update(code).digest("hex")),
      )
      .take(2),
  );
  if (rows.length !== 1) throw new Error("Expected one login code row");
  return rows[0];
}

async function updateMembership(
  t: Awaited<ReturnType<typeof seedRedemptionScenario>>["t"],
  membershipId: Awaited<
    ReturnType<typeof seedRedemptionScenario>
  >["membershipId"],
  updates: {
    role?: "org:admin" | "org:member";
    state?: "active" | "revoked";
  },
) {
  await t.run(async (ctx) => {
    await ctx.db.patch("organizationMemberships", membershipId, updates);
  });
}

describe("Evidence Library admin login redemption", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
  });

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

  it("returns Editor for an explicit library collaborator", async () => {
    vi.stubEnv("ENCRYPTION_KEY", encryptionKey);
    const { libraryId, membershipId, owner, t } =
      await seedRedemptionScenario();
    const machineCredential = await owner.action(
      api.evidenceLibraries.credentialActions.rotateServiceCredential,
      { libraryId },
    );
    await updateMembership(t, membershipId, { role: "org:member" });
    await t.run(ctx => ctx.db.insert("evidenceLibraryMembers", {
      libraryId, clerkUserId: "user_admin_login_redemption", role: "editor",
      grantedBy: "owner", grantedAt: Date.now(),
    }));
    const editor = t.withIdentity({
      subject: "user_admin_login_redemption",
      o: { id: "org_admin_login_redemption", rol: "org:member" },
    });
    const loginCode = await issueLoginCode(editor, libraryId);

    const response = await redeem(t, {
      libraryId,
      machineCredential: machineCredential.credential,
      code: loginCode.code,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      libraryId,
      clerkUserId: "user_admin_login_redemption",
      clerkOrganizationId: "org_admin_login_redemption",
      role: "editor",
      consumedAt: expect.any(Number),
    });
  });

  it("checks current access with a library-bound machine credential", async () => {
    vi.stubEnv("ENCRYPTION_KEY", encryptionKey);
    const { libraryId, secondLibraryId, owner, t } = await seedRedemptionScenario();
    const { machineCredential } = await issueRedemptionPair(owner, libraryId);
    const assignmentId = await t.run(ctx => ctx.db.insert("evidenceLibraryMembers", {
      libraryId, clerkUserId: "external_creator", role: "creator", grantedBy: "owner", grantedAt: Date.now(),
    }));
    const check = (targetLibrary = libraryId) => t.fetch("/api/v1/evidence-libraries/admin-session/check", {
      method: "POST", headers: { Authorization: `Bearer ${machineCredential.credential}`, "Content-Type": "application/json" },
      body: JSON.stringify({ libraryId: targetLibrary, clerkUserId: "external_creator" }),
    });
    let response = await check();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ role: "creator" });
    expect((await check(secondLibraryId)).status).toBe(403);
    await owner.mutation(api.evidenceLibraries.team.changeRole, { libraryId, clerkUserId: "external_creator", role: "editor" });
    response = await check();
    expect(await response.json()).toEqual({ role: "editor" });
    await owner.mutation(api.evidenceLibraries.team.removeMember, { libraryId, clerkUserId: "external_creator" });
    expect((await check()).status).toBe(403);
    expect(await t.run(ctx => ctx.db.get("evidenceLibraryMembers", assignmentId))).toBeNull();
  });

  it("rejects a replay and records one redemption", async () => {
    vi.stubEnv("ENCRYPTION_KEY", encryptionKey);
    const { libraryId, owner, t } = await seedRedemptionScenario();
    const { loginCode, machineCredential } = await issueRedemptionPair(
      owner,
      libraryId,
    );
    const request = {
      libraryId,
      machineCredential: machineCredential.credential,
      code: loginCode.code,
    };

    const firstResponse = await redeem(t, request);
    const replayResponse = await redeem(t, request);

    expect(firstResponse.status).toBe(200);
    expect(replayResponse.status).toBe(400);
    await expect(replayResponse.json()).resolves.toEqual({
      error: "invalid_login_code",
    });
    const auditRows = await t.run(async (ctx) =>
      ctx.db
        .query("auditLogs")
        .withIndex("by_action", (query) =>
          query.eq("action", "evidence_library.admin_login_code.redeemed"),
        )
        .take(2),
    );
    expect(auditRows).toHaveLength(1);
  });

  it("allows exactly one of two simultaneous redemptions", async () => {
    vi.stubEnv("ENCRYPTION_KEY", encryptionKey);
    const { libraryId, owner, t } = await seedRedemptionScenario();
    const { loginCode, machineCredential } = await issueRedemptionPair(
      owner,
      libraryId,
    );
    const request = {
      libraryId,
      machineCredential: machineCredential.credential,
      code: loginCode.code,
    };

    const responses = await Promise.all([
      redeem(t, request),
      redeem(t, request),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 400,
    ]);
    const bodies = await Promise.all(
      responses.map((response) => response.json()),
    );
    expect(bodies).toContainEqual({ error: "invalid_login_code" });

    const auditRows = await t.run(async (ctx) =>
      ctx.db
        .query("auditLogs")
        .withIndex("by_action", (query) =>
          query.eq("action", "evidence_library.admin_login_code.redeemed"),
        )
        .take(2),
    );
    expect(auditRows).toHaveLength(1);
  });

  it("rejects a rotated machine credential without consuming the code", async () => {
    vi.stubEnv("ENCRYPTION_KEY", encryptionKey);
    const { libraryId, owner, t } = await seedRedemptionScenario();
    const { loginCode, machineCredential: oldCredential } =
      await issueRedemptionPair(owner, libraryId);
    const newCredential = await owner.action(
      api.evidenceLibraries.credentialActions.rotateServiceCredential,
      { libraryId },
    );

    const rejected = await redeem(t, {
      libraryId,
      machineCredential: oldCredential.credential,
      code: loginCode.code,
    });
    expect(rejected.status).toBe(401);
    expect(rejected.headers.get("www-authenticate")).toBe("Bearer");
    await expect(rejected.json()).resolves.toEqual({
      error: "invalid_service_credential",
    });
    expect(
      (await readCodeRow(t, libraryId, loginCode.code)).consumedAt,
    ).toBeUndefined();

    const accepted = await redeem(t, {
      libraryId,
      machineCredential: newCredential.credential,
      code: loginCode.code,
    });
    expect(accepted.status).toBe(200);
  });

  it("rejects a code for the wrong library without consuming it", async () => {
    vi.stubEnv("ENCRYPTION_KEY", encryptionKey);
    const { libraryId, owner, secondLibraryId, t } =
      await seedRedemptionScenario();
    const { loginCode, machineCredential } = await issueRedemptionPair(
      owner,
      libraryId,
    );
    const secondLibraryCredential = await owner.action(
      api.evidenceLibraries.credentialActions.rotateServiceCredential,
      { libraryId: secondLibraryId },
    );

    const rejected = await redeem(t, {
      libraryId: secondLibraryId,
      machineCredential: secondLibraryCredential.credential,
      code: loginCode.code,
    });
    expect(rejected.status).toBe(400);
    await expect(rejected.json()).resolves.toEqual({
      error: "invalid_login_code",
    });
    expect(
      (await readCodeRow(t, libraryId, loginCode.code)).consumedAt,
    ).toBeUndefined();

    const accepted = await redeem(t, {
      libraryId,
      machineCredential: machineCredential.credential,
      code: loginCode.code,
    });
    expect(accepted.status).toBe(200);
  });

  it("rejects an expired code without consuming it", async () => {
    vi.stubEnv("ENCRYPTION_KEY", encryptionKey);
    const { libraryId, owner, t } = await seedRedemptionScenario();
    const { loginCode, machineCredential } = await issueRedemptionPair(
      owner,
      libraryId,
    );
    const codeRow = await readCodeRow(t, libraryId, loginCode.code);
    await t.run(async (ctx) => {
      await ctx.db.patch("evidenceLibraryAdminLoginCodes", codeRow._id, {
        expiresAt: Date.now() - 1,
      });
    });

    const rejected = await redeem(t, {
      libraryId,
      machineCredential: machineCredential.credential,
      code: loginCode.code,
    });

    expect(rejected.status).toBe(400);
    await expect(rejected.json()).resolves.toEqual({
      error: "invalid_login_code",
    });
    expect(
      (await readCodeRow(t, libraryId, loginCode.code)).consumedAt,
    ).toBeUndefined();
  });

  it.each([
    {
      label: "revoked membership",
      rejectWith: { state: "revoked" as const },
      restoreWith: { state: "active" as const },
    },
    {
      label: "changed role",
      rejectWith: { role: "org:member" as const },
      restoreWith: { role: "org:admin" as const },
    },
  ])("checks the current $label before consuming", async (scenario) => {
    vi.stubEnv("ENCRYPTION_KEY", encryptionKey);
    const { libraryId, membershipId, owner, t } =
      await seedRedemptionScenario();
    const { loginCode, machineCredential } = await issueRedemptionPair(
      owner,
      libraryId,
    );
    await updateMembership(t, membershipId, scenario.rejectWith);

    const rejected = await redeem(t, {
      libraryId,
      machineCredential: machineCredential.credential,
      code: loginCode.code,
    });
    expect(rejected.status).toBe(400);
    await expect(rejected.json()).resolves.toEqual({
      error: "invalid_login_code",
    });
    expect(
      (await readCodeRow(t, libraryId, loginCode.code)).consumedAt,
    ).toBeUndefined();

    await updateMembership(t, membershipId, scenario.restoreWith);
    const accepted = await redeem(t, {
      libraryId,
      machineCredential: machineCredential.credential,
      code: loginCode.code,
    });
    expect(accepted.status).toBe(200);
  });

  it("returns bounded no-store errors for malformed requests", async () => {
    const unauthenticatedTest = convexTest(schema, modules);
    const missingCredential = await unauthenticatedTest.fetch(redemptionPath, {
      method: "POST",
      body: "{}",
    });
    expect(missingCredential.status).toBe(401);
    expect(missingCredential.headers.get("cache-control")).toBe("no-store");
    await expect(missingCredential.json()).resolves.toEqual({
      error: "invalid_service_credential",
    });

    vi.stubEnv("ENCRYPTION_KEY", encryptionKey);
    const { libraryId, owner, t } = await seedRedemptionScenario();
    const machineCredential = await owner.action(
      api.evidenceLibraries.credentialActions.rotateServiceCredential,
      { libraryId },
    );
    const malformedBody = await t.fetch(redemptionPath, {
      method: "POST",
      headers: { Authorization: `Bearer ${machineCredential.credential}` },
      body: "not-json",
    });
    expect(malformedBody.status).toBe(400);
    expect(malformedBody.headers.get("cache-control")).toBe("no-store");
    await expect(malformedBody.json()).resolves.toEqual({
      error: "invalid_request",
    });
  });
});
