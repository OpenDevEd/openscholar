import { describe, expect, it } from "vitest";
import {
  mapWorkosMembershipToRemoveArgs,
  mapWorkosMembershipToSyncArgs,
  mapWorkosRole,
  mapWorkosUserToSyncArgs,
} from "../convex/webhooks/workos_mappers";

describe("workos webhook normalization", () => {
  it("normalizes user.updated payload fields to Convex mutation args", () => {
    const args = mapWorkosUserToSyncArgs({
      id: "user_123",
      email: "user@example.com",
      firstName: "Ava",
      lastName: "Stone",
      profilePictureUrl: "https://cdn.test/avatar.png",
    });

    expect(args).toEqual({
      workosId: "user_123",
      email: "user@example.com",
      firstName: "Ava",
      lastName: "Stone",
      avatarUrl: "https://cdn.test/avatar.png",
    });
  });

  it("normalizes organization_membership payload to sync args", () => {
    const args = mapWorkosMembershipToSyncArgs({
      userId: "user_123",
      organizationId: "org_456",
      role: { slug: "org:admin" },
    });

    expect(args).toEqual({
      userWorkosId: "user_123",
      orgWorkosId: "org_456",
      role: "admin",
    });
  });

  it("normalizes organization_membership payload to remove args", () => {
    const args = mapWorkosMembershipToRemoveArgs({
      userId: "user_123",
      organizationId: "org_456",
      role: { slug: "org:owner" },
    });

    expect(args).toEqual({
      userWorkosId: "user_123",
      orgWorkosId: "org_456",
    });
  });

  it("maps role slugs to canonical application roles", () => {
    expect(mapWorkosRole("org:owner")).toBe("owner");
    expect(mapWorkosRole("org:admin")).toBe("admin");
    expect(mapWorkosRole("owner")).toBe("owner");
    expect(mapWorkosRole("admin")).toBe("admin");
    expect(mapWorkosRole("unexpected-role")).toBe("member");
    expect(mapWorkosRole(undefined)).toBe("member");
  });
});
