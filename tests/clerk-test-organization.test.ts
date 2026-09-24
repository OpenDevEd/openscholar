import { describe, expect, it, vi } from "vitest";
import { cleanupStaleBillingClerkUsers } from "../scripts/clerk-test-organization.mjs";

describe("cleanupStaleBillingClerkUsers", () => {
  it("deletes abandoned billing users without touching other organization members", async () => {
    const getOrganizationMembershipList = vi.fn().mockResolvedValue({
      data: [
        {
          publicUserData: {
            identifier: "billing-e2e-1788271000000-abc123+clerk_test@example.com",
            userId: "user_stale",
          },
        },
        {
          publicUserData: {
            identifier: "library-e2e-1788271000000-def456+clerk_test@example.com",
            userId: "user_library",
          },
        },
        {
          publicUserData: {
            identifier: "owner@example.com",
            userId: "user_owner",
          },
        },
      ],
      totalCount: 3,
    });
    const deleteUser = vi.fn().mockResolvedValue(undefined);

    const removed = await cleanupStaleBillingClerkUsers(
      {
        organizations: { getOrganizationMembershipList },
        users: { deleteUser },
      },
      "org_test",
    );

    expect(removed).toBe(1);
    expect(getOrganizationMembershipList).toHaveBeenCalledWith({
      organizationId: "org_test",
      emailAddressQuery: "billing-e2e-",
      limit: 100,
    });
    expect(deleteUser).toHaveBeenCalledOnce();
    expect(deleteUser).toHaveBeenCalledWith("user_stale");
  });
});
