import { describe, expect, test } from "vitest";

import { parseOrganizationClaims } from "./access";

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
