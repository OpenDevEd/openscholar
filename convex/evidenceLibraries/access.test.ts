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
});

describe("canPerformOrganizationAction", () => {
  test("allows admins to manage while members remain read-only", () => {
    expect(canPerformOrganizationAction("org:admin", "read")).toBe(true);
    expect(canPerformOrganizationAction("org:admin", "manage")).toBe(true);
    expect(canPerformOrganizationAction("org:member", "read")).toBe(true);
    expect(canPerformOrganizationAction("org:member", "manage")).toBe(false);
  });
});
