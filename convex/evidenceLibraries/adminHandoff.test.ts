/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import {
  createDeployedSetupFixture,
  createReadySetupFixture,
  essentialSetupSections,
  toSectionRows,
} from "../../tests/helpers/evidence-library-setup-fixture";

const modules = import.meta.glob("/convex/**/*.ts");

/**
 * The library's own organisation decides admin access, so every caller in
 * these tests carries a *different* active organisation in the token.
 */
function signedInElsewhere(
  fixture: { t: ReturnType<typeof convexTest>; clerkUserId: string },
  role: "org:admin" | "org:member" = "org:admin",
) {
  return fixture.t.withIdentity({
    subject: fixture.clerkUserId,
    o: { id: "org_somewhere_else", rol: role },
  });
}

async function setMembershipRole(
  fixture: Awaited<ReturnType<typeof createReadySetupFixture>>,
  role: "org:admin" | "org:member",
) {
  await fixture.t.run(async (ctx) => {
    await ctx.db.patch(fixture.membershipId, { role });
  });
}

describe("Evidence Library admin handoff", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("lets an owner of the library's organisation in while another organisation is active, and keeps the code digest-only", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T09:00:00.000Z"));
    const fixture = await createReadySetupFixture("admin_handoff_owner");
    const libraryId = fixture.created.libraryId;

    const result = await signedInElsewhere(fixture).action(
      api.evidenceLibraries.adminHandoffActions.issueAdminHandoff,
      { libraryId, returnPath: "/admin/items?page=2" },
    );

    expect(result.status).toBe("allowed");
    if (result.status !== "allowed") return;
    const launchUrl = new URL(result.launchUrl);
    expect(launchUrl.origin).toBe(
      new URL(fixture.created.publicAddress).origin,
    );
    expect(launchUrl.pathname).toBe("/api/admin/session");
    expect(launchUrl.searchParams.get("return")).toBe("/admin/items?page=2");
    const code = launchUrl.searchParams.get("code") ?? "";
    expect(code).toMatch(/^elc_[A-Za-z0-9_-]{43}$/);

    const rows = await fixture.t.run(async (ctx) =>
      ctx.db.query("evidenceLibraryAdminLoginCodes").take(2),
    );
    expect(rows).toEqual([
      expect.objectContaining({
        libraryId,
        organizationId: fixture.organizationId,
        clerkUserId: fixture.clerkUserId,
        role: "owner",
        codeDigest: createHash("sha256").update(code).digest("hex"),
        issuedAt: Date.now(),
        expiresAt: Date.now() + 5 * 60 * 1000,
      }),
    ]);
    expect(rows[0]).not.toHaveProperty("code");
    expect(rows[0]).not.toHaveProperty("consumedAt");

    const auditRows = await fixture.t.run(async (ctx) =>
      ctx.db
        .query("auditLogs")
        .withIndex("by_action", (query) =>
          query.eq("action", "evidence_library.admin_login_code.issued"),
        )
        .take(2),
    );
    expect(auditRows).toEqual([
      expect.objectContaining({
        userId: fixture.clerkUserId,
        metadata: {
          codeId: rows[0]._id,
          libraryId,
          organizationId: fixture.organizationId,
          role: "owner",
        },
      }),
    ]);
  });

  it("binds an editor of the library's organisation to the editor role", async () => {
    const fixture = await createReadySetupFixture("admin_handoff_editor");
    await setMembershipRole(fixture, "org:member");

    const result = await signedInElsewhere(fixture).action(
      api.evidenceLibraries.adminHandoffActions.issueAdminHandoff,
      { libraryId: fixture.created.libraryId },
    );

    expect(result).toMatchObject({ status: "allowed" });
    const rows = await fixture.t.run(async (ctx) =>
      ctx.db.query("evidenceLibraryAdminLoginCodes").take(2),
    );
    expect(rows).toEqual([expect.objectContaining({ role: "editor" })]);
  });

  it("keeps letting members in after Evidence Libraries are switched off for the organisation", async () => {
    const fixture = await createReadySetupFixture("admin_handoff_switched_off");
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(fixture.organizationId, {
        evidenceLibrariesEnabled: false,
      });
    });

    await expect(
      signedInElsewhere(fixture).action(
        api.evidenceLibraries.adminHandoffActions.issueAdminHandoff,
        { libraryId: fixture.created.libraryId },
      ),
    ).resolves.toMatchObject({ status: "allowed" });
  });

  it("keeps setup libraries closed until their deployment receipt exists", async () => {
    const fixture = await createReadySetupFixture(
      "admin_handoff_setup_receipt",
    );
    await fixture.t.run(async (ctx) => {
      const operation = await ctx.db.get(fixture.created.setupOperationId);
      if (!operation?.receipt) throw new Error("Setup receipt is missing");
      await ctx.db.patch(operation._id, {
        receipt: { ...operation.receipt, runtimeReceiptId: undefined },
      });
    });

    await expect(
      signedInElsewhere(fixture).query(
        api.evidenceLibraries.adminHandoff.readAdminHandoffState,
        { libraryId: fixture.created.libraryId },
      ),
    ).resolves.toEqual({ status: "not_ready", isOwner: true });
  });

  it("refuses a signed-in person who is not a member, and names the organisation", async () => {
    const fixture = await createReadySetupFixture("admin_handoff_outsider");
    const outsider = fixture.t.withIdentity({
      subject: "user_outsider",
      o: { id: "org_somewhere_else", rol: "org:admin" },
    });

    await expect(
      outsider.action(
        api.evidenceLibraries.adminHandoffActions.issueAdminHandoff,
        { libraryId: fixture.created.libraryId },
      ),
    ).resolves.toEqual({
      status: "no_access",
      organisationName: "Team admin_handoff_outsider",
    });

    const rows = await fixture.t.run(async (ctx) =>
      ctx.db.query("evidenceLibraryAdminLoginCodes").take(1),
    );
    expect(rows).toHaveLength(0);
  });

  it("refuses a member whose membership was revoked or whose organisation was closed", async () => {
    const revoked = await createReadySetupFixture("admin_handoff_revoked");
    await revoked.t.run(async (ctx) => {
      await ctx.db.patch(revoked.membershipId, { state: "revoked" });
    });
    await expect(
      signedInElsewhere(revoked).action(
        api.evidenceLibraries.adminHandoffActions.issueAdminHandoff,
        { libraryId: revoked.created.libraryId },
      ),
    ).resolves.toMatchObject({ status: "no_access" });

    const closed = await createReadySetupFixture("admin_handoff_closed");
    await closed.t.run(async (ctx) => {
      await ctx.db.patch(closed.organizationId, { state: "deleted" });
    });
    await expect(
      signedInElsewhere(closed).action(
        api.evidenceLibraries.adminHandoffActions.issueAdminHandoff,
        { libraryId: closed.created.libraryId },
      ),
    ).resolves.toMatchObject({ status: "no_access" });
  });

  it("answers not ready, with the caller's role, before the runtime is live", async () => {
    const fixture = await createDeployedSetupFixture("admin_handoff_pending");

    await expect(
      signedInElsewhere(fixture).action(
        api.evidenceLibraries.adminHandoffActions.issueAdminHandoff,
        { libraryId: fixture.created.libraryId },
      ),
    ).resolves.toEqual({ status: "not_ready", isOwner: true });

    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(fixture.membershipId, { role: "org:member" });
    });
    await expect(
      signedInElsewhere(fixture).action(
        api.evidenceLibraries.adminHandoffActions.issueAdminHandoff,
        { libraryId: fixture.created.libraryId },
      ),
    ).resolves.toEqual({ status: "not_ready", isOwner: false });

    const rows = await fixture.t.run(async (ctx) =>
      ctx.db.query("evidenceLibraryAdminLoginCodes").take(1),
    );
    expect(rows).toHaveLength(0);
  });

  it.each([
    { label: "another site", returnPath: "https://evil.example/steal" },
    { label: "a protocol-relative address", returnPath: "//evil.example" },
    { label: "a page outside the admin area", returnPath: "/records" },
    { label: "a backslash trick", returnPath: "/\\evil.example" },
    { label: "an empty value", returnPath: "" },
    { label: "an encoded walk out", returnPath: "/admin/%2e%2e/records" },
    { label: "a double-encoded walk out", returnPath: "/admin/%252e%252e/x" },
    { label: "an encoded slash", returnPath: "/admin%2Frecords" },
    { label: "an encoded backslash", returnPath: "/admin%5Crecords" },
    { label: "a broken escape", returnPath: "/admin/%zz" },
  ])("drops a return path pointing at $label", async ({ returnPath }) => {
    const fixture = await createReadySetupFixture(
      `admin_handoff_return_${returnPath.replace(/\W/g, "") || "empty"}`,
    );

    const result = await signedInElsewhere(fixture).action(
      api.evidenceLibraries.adminHandoffActions.issueAdminHandoff,
      { libraryId: fixture.created.libraryId, returnPath },
    );

    expect(result.status).toBe("allowed");
    if (result.status !== "allowed") return;
    expect(new URL(result.launchUrl).searchParams.get("return")).toBe("/admin");
  });

  it("keeps a translated admin path", async () => {
    const fixture = await createReadySetupFixture("admin_handoff_locale");

    const result = await signedInElsewhere(fixture).action(
      api.evidenceLibraries.adminHandoffActions.issueAdminHandoff,
      {
        libraryId: fixture.created.libraryId,
        returnPath: "/en-GB/admin/files",
      },
    );

    expect(result.status).toBe("allowed");
    if (result.status !== "allowed") return;
    expect(new URL(result.launchUrl).searchParams.get("return")).toBe(
      "/en-GB/admin/files",
    );
  });

  it("keeps the live runtime reachable while a newer revision waits for deployment", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T09:00:00.000Z"));
    const fixture = await createReadySetupFixture("admin_handoff_pending_rev");
    const activeRevisionId = fixture.activated.revisionId;
    const saved = await fixture.admin.mutation(
      api.evidenceLibraries.mutations.saveDraftSections,
      {
        libraryId: fixture.created.libraryId,
        sections: toSectionRows({
          ...essentialSetupSections,
          identity: {
            ...essentialSetupSections.identity,
            shortName: "Updated Climate",
          },
        }),
        expectedEditVersion: fixture.activated.editVersion,
      },
    );
    const pending = await fixture.admin.mutation(
      api.evidenceLibraries.mutations.activateConfiguration,
      {
        libraryId: fixture.created.libraryId,
        expectedEditVersion: saved.editVersion,
      },
    );

    expect(pending).toMatchObject({ kind: "publish", status: "running" });
    const library = await fixture.t.run((ctx) =>
      ctx.db.get("evidenceLibraries", fixture.created.libraryId),
    );
    expect(library).toMatchObject({
      activeRevisionId,
      latestRevisionId: pending.revisionId,
    });
    await expect(
      signedInElsewhere(fixture).action(
        api.evidenceLibraries.adminHandoffActions.issueAdminHandoff,
        { libraryId: fixture.created.libraryId },
      ),
    ).resolves.toMatchObject({
      status: "allowed",
      launchUrl: expect.stringContaining("/api/admin/session?code="),
    });
  });

  it("refuses a library that does not exist without naming anything", async () => {
    const fixture = await createReadySetupFixture("admin_handoff_unknown");

    await expect(
      signedInElsewhere(fixture).action(
        api.evidenceLibraries.adminHandoffActions.issueAdminHandoff,
        { libraryId: "not-a-library-id" },
      ),
    ).resolves.toEqual({ status: "no_access", organisationName: null });
  });

  it("answers the refusal page without handing out a code", async () => {
    const outsiderView = await createReadySetupFixture("admin_handoff_view");
    const outsider = outsiderView.t.withIdentity({
      subject: "user_outsider",
      o: { id: "org_somewhere_else", rol: "org:admin" },
    });

    await expect(
      outsider.query(api.evidenceLibraries.adminHandoff.readAdminHandoffState, {
        libraryId: outsiderView.created.libraryId,
      }),
    ).resolves.toEqual({
      status: "no_access",
      organisationName: "Team admin_handoff_view",
    });
    await expect(
      signedInElsewhere(outsiderView).query(
        api.evidenceLibraries.adminHandoff.readAdminHandoffState,
        { libraryId: outsiderView.created.libraryId },
      ),
    ).resolves.toEqual({ status: "allowed" });

    const rows = await outsiderView.t.run(async (ctx) =>
      ctx.db.query("evidenceLibraryAdminLoginCodes").take(1),
    );
    expect(rows).toHaveLength(0);

    const pending = await createDeployedSetupFixture("admin_handoff_view_wait");
    await expect(
      signedInElsewhere(pending).query(
        api.evidenceLibraries.adminHandoff.readAdminHandoffState,
        { libraryId: pending.created.libraryId },
      ),
    ).resolves.toEqual({ status: "not_ready", isOwner: true });
  });

  it("refuses a caller who is not signed in", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.action(api.evidenceLibraries.adminHandoffActions.issueAdminHandoff, {
        libraryId: "not-a-library-id",
      }),
    ).rejects.toThrow(/sign in/i);
    await expect(
      t.query(api.evidenceLibraries.adminHandoff.readAdminHandoffState, {
        libraryId: "not-a-library-id",
      }),
    ).rejects.toThrow(/sign in/i);
  });
});
