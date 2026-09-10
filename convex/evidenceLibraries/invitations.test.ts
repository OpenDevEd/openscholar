/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import { createActivatedSetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";

const mail = vi.hoisted(() => ({ sendMail: vi.fn(), close: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => mail } }));

async function setup() {
  const fixture = await createActivatedSetupFixture("invitations");
  const libraryId = fixture.created.libraryId;
  await fixture.t.run(ctx => ctx.db.insert("users", { clerkId: "outside", email: "outside@example.org", state: "active", createdAt: 1, updatedAt: 1 }));
  const outside = fixture.t.withIdentity({ subject: "outside" });
  const invite = () => fixture.admin.action(api.evidenceLibraries.invitationActions.invite, { libraryId, email: "Outside@example.org", role: "creator" });
  return { ...fixture, libraryId, outside, invite };
}

describe("library invitations", () => {
  beforeEach(() => {
    vi.stubEnv("EVIDENCE_LIBRARY_PLATFORM_DOMAIN", "libraries.example.test");
    vi.stubEnv("EL_COOLIFY_ENVIRONMENT", "development");
    vi.stubEnv("EL_SMTP_HOST", "smtp.example.test");
    vi.stubEnv("EL_SMTP_FROM", "libraries@example.test");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
    vi.stubEnv("CLERK_SECRET_KEY", "test-clerk-key");
    mail.sendMail.mockReset().mockResolvedValue({});
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ email_addresses: [{ email_address: "outside@example.org", verification: { status: "verified" } }] })));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("accepts external access only after verified email confirmation without joining the organization", async () => {
    const fixture = await setup();
    await fixture.invite();
    const invitations = await fixture.outside.query(api.evidenceLibraries.invitations.listMine, {});
    expect(invitations).toEqual([expect.objectContaining({ libraryId: fixture.libraryId, role: "creator" })]);
    expect(await fixture.outside.query(api.evidenceLibraries.queries.listLibraryOverviews, {})).toEqual([]);
    await fixture.outside.action(api.evidenceLibraries.invitationActions.respond, { invitationId: invitations[0].invitationId, accept: true });
    expect(await fixture.outside.query(api.evidenceLibraries.queries.listLibraryOverviews, {})).toEqual([expect.objectContaining({ _id: fixture.libraryId, role: "creator" })]);
    expect(await fixture.t.run(ctx => ctx.db.query("organizationMemberships").withIndex("by_clerkUserId_and_state", q => q.eq("clerkUserId", "outside").eq("state", "active")).collect())).toEqual([]);
    expect(await fixture.outside.query(api.evidenceLibraries.invitations.listMine, {})).toEqual([]);
    expect(mail.sendMail.mock.calls[0][0]).toMatchObject({ from: {name: "Climate Evidence", address: "libraries@example.test"}, to: "outside@example.org", text: expect.stringContaining("https://app.example.test/evidence-libraries") });
  });

  it("rejects an unverified email and a cancelled invitation", async () => {
    const fixture = await setup();
    await fixture.invite();
    const [invitation] = await fixture.outside.query(api.evidenceLibraries.invitations.listMine, {});
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ email_addresses: [{ email_address: "outside@example.org", verification: { status: "unverified" } }] })));
    await expect(fixture.outside.action(api.evidenceLibraries.invitationActions.respond, { invitationId: invitation.invitationId, accept: true })).rejects.toThrow();
    await fixture.admin.mutation(api.evidenceLibraries.invitations.change, { invitationId: invitation.invitationId, cancel: true });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ email_addresses: [{ email_address: "outside@example.org", verification: { status: "verified" } }] })));
    await expect(fixture.outside.action(api.evidenceLibraries.invitationActions.respond, { invitationId: invitation.invitationId, accept: true })).rejects.toThrow();
    expect(await fixture.outside.query(api.evidenceLibraries.queries.listLibraryOverviews, {})).toEqual([]);
  });

  it("refuses invitations from a collaborator and records delivery failure for the Owner", async () => {
    const fixture = await setup();
    await expect(fixture.outside.action(api.evidenceLibraries.invitationActions.invite, { libraryId: fixture.libraryId, email: "someone@example.org", role: "editor" })).rejects.toThrow();
    mail.sendMail.mockRejectedValueOnce(new Error("SMTP unavailable"));
    await expect(fixture.invite()).rejects.toThrow();
    const team = await fixture.admin.query(api.evidenceLibraries.queries.listTeam, { libraryId: fixture.libraryId });
    expect(team.invitations).toEqual([expect.objectContaining({ email: "outside@example.org", delivery: "failed" })]);
  });
});
