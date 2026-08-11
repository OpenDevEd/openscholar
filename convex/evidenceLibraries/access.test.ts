import { describe, expect, test } from "vitest";

import { canPerformOrganizationAction, parseOrganizationClaims } from "./access";

describe("parseOrganizationClaims", () => {
  test("accepts the verified active-organization admin claim", () => {
    expect(
      parseOrganizationClaims({
        subject: "user_admin",
        o: {
          id: "org_evidence_library",
          rol: "org:admin",
        },
      }),
    ).toEqual({
      organizationId: "org_evidence_library",
      role: "org:admin",
      canManage: true,
    });
  });

  test("rejects missing, unprefixed, and Clerk v1 organization claims", () => {
    expect(parseOrganizationClaims({ subject: "user_missing" })).toBeNull();
    expect(
      parseOrganizationClaims({
        subject: "user_default_token",
        o: { id: "org_evidence_library", rol: "admin" },
      }),
    ).toBeNull();
    expect(
      parseOrganizationClaims({
        subject: "user_legacy",
        org_id: "org_evidence_library",
        org_role: "org:admin",
      }),
    ).toBeNull();
  });
});

describe("canPerformOrganizationAction", () => {
  test("allows admins to manage while members remain read-only", () => {
    expect(canPerformOrganizationAction("org:admin", "read")).toBe(true);
    expect(canPerformOrganizationAction("org:admin", "manage")).toBe(true);
    expect(canPerformOrganizationAction("org:member", "read")).toBe(true);
    expect(canPerformOrganizationAction("org:member", "manage")).toBe(false);
  });
});
