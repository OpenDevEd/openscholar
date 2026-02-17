import { describe, expect, it } from "vitest";
import { resolveOwnerIdForSubscriptionSync } from "../convex/subscriptions/lib/ownerResolution";

describe("portal re-subscribe owner resolution", () => {
  it("prefers existing subscription owner when present", () => {
    expect(
      resolveOwnerIdForSubscriptionSync({
        existingSubscriptionOwnerId: "user_existing",
        linkedBillingCustomerUserId: "user_linked",
        componentCustomerMetadataUserId: "user_component",
        subscriptionMetadataUserId: "user_metadata",
      }),
    ).toBe("user_existing");
  });

  it("resolves metadata-missing re-subscribe via billing customer link", () => {
    expect(
      resolveOwnerIdForSubscriptionSync({
        existingSubscriptionOwnerId: null,
        linkedBillingCustomerUserId: "user_linked",
        componentCustomerMetadataUserId: null,
        subscriptionMetadataUserId: null,
      }),
    ).toBe("user_linked");
  });

  it("falls back to component metadata then subscription metadata", () => {
    expect(
      resolveOwnerIdForSubscriptionSync({
        existingSubscriptionOwnerId: null,
        linkedBillingCustomerUserId: null,
        componentCustomerMetadataUserId: "user_component",
        subscriptionMetadataUserId: "user_metadata",
      }),
    ).toBe("user_component");

    expect(
      resolveOwnerIdForSubscriptionSync({
        existingSubscriptionOwnerId: null,
        linkedBillingCustomerUserId: null,
        componentCustomerMetadataUserId: null,
        subscriptionMetadataUserId: "user_metadata",
      }),
    ).toBe("user_metadata");
  });
});
