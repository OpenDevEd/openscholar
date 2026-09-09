import { describe, expect, it } from "vitest";
import { parseClerkProjectionEvent } from "./clerk_mappers";

const organization = {
  id: "org_123",
  name: "Evidence Team",
  slug: "evidence-team",
  image_url: "https://img.example/org.png",
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_001_000,
};

const membership = {
  id: "orgmem_123",
  role: "org:member",
  created_at: 1_700_000_002_000,
  updated_at: 1_700_000_003_000,
  organization,
  public_user_data: { user_id: "user_123" },
};

describe("parseClerkProjectionEvent", () => {
  it.each(["organization.created", "organization.updated"] as const)(
    "maps %s to an active organization snapshot",
    (eventType) => {
      expect(parseClerkProjectionEvent(eventType, organization)).toEqual({
        action: "upsert",
        entityId: "org_123",
        kind: "organization",
        organization: {
          clerkCreatedAt: 1_700_000_000_000,
          clerkOrganizationId: "org_123",
          clerkUpdatedAt: 1_700_000_001_000,
          evidenceLibrariesEnabled: false,
          authorsEnabled: false,
          extractionEnabled: false,
          imageUrl: "https://img.example/org.png",
          name: "Evidence Team",
          slug: "evidence-team",
        },
      });
    },
  );

  it.each([
    ["switched on", { evidenceLibraries: true }, true],
    ["switched off", { evidenceLibraries: false }, false],
    ["missing the key", { somethingElse: true }, false],
    ["an empty object", {}, false],
    ["the string true", { evidenceLibraries: "true" }, false],
    ["the number one", { evidenceLibraries: 1 }, false],
    ["null", null, false],
  ] as const)(
    "reads the Evidence Libraries switch from public metadata: %s",
    (_label, publicMetadata, expected) => {
      const event = parseClerkProjectionEvent("organization.updated", {
        ...organization,
        public_metadata: publicMetadata,
      });

      expect(event).toMatchObject({
        organization: { evidenceLibrariesEnabled: expected },
      });
    },
  );

  it("reads the switch from the organization inside a membership event", () => {
    expect(
      parseClerkProjectionEvent("organizationMembership.created", {
        ...membership,
        organization: {
          ...organization,
          public_metadata: { evidenceLibraries: true },
        },
      }),
    ).toMatchObject({
      membership: { organization: { evidenceLibrariesEnabled: true } },
    });
  });

  it("maps organization.deleted from Clerk's tombstone payload", () => {
    expect(
      parseClerkProjectionEvent("organization.deleted", {
        object: "organization",
        id: "org_123",
        slug: "evidence-team",
        deleted: true,
      }),
    ).toEqual({
      action: "delete",
      entityId: "org_123",
      kind: "organization",
    });
  });

  it.each([
    ["organizationMembership.created", "upsert", "active"],
    ["organizationMembership.updated", "upsert", "active"],
    ["organizationMembership.deleted", "delete", "revoked"],
  ] as const)("maps %s with its nested organization", (eventType, action, state) => {
    expect(parseClerkProjectionEvent(eventType, membership)).toEqual({
      action,
      entityId: "orgmem_123",
      kind: "membership",
      membership: {
        clerkCreatedAt: 1_700_000_002_000,
        clerkMembershipId: "orgmem_123",
        clerkUpdatedAt: 1_700_000_003_000,
        clerkUserId: "user_123",
        organization: {
          clerkCreatedAt: 1_700_000_000_000,
          clerkOrganizationId: "org_123",
          clerkUpdatedAt: 1_700_000_001_000,
          evidenceLibrariesEnabled: false,
          authorsEnabled: false,
          extractionEnabled: false,
          imageUrl: "https://img.example/org.png",
          name: "Evidence Team",
          slug: "evidence-team",
        },
        role: "org:member",
        state,
      },
    });
  });

  it("rejects unsupported roles and malformed tombstones", () => {
    expect(
      parseClerkProjectionEvent("organizationMembership.updated", {
        ...membership,
        role: "admin",
      }),
    ).toBeNull();
    expect(
      parseClerkProjectionEvent("organization.deleted", {
        object: "organization",
        deleted: true,
      }),
    ).toBeNull();
  });
});
