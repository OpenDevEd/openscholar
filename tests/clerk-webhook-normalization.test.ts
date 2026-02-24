import { describe, expect, it } from "vitest";
import {
  mapClerkUserToDeleteArgs,
  mapClerkUserToUpsertArgs,
} from "../convex/webhooks/clerk_mappers";

describe("clerk webhook normalization", () => {
  it("normalizes user payload to Convex upsert args", () => {
    const args = mapClerkUserToUpsertArgs({
      id: "user_123",
      first_name: "Ava",
      last_name: "Stone",
      image_url: "https://cdn.test/avatar.png",
      primary_email_address_id: "email_2",
      email_addresses: [
        { id: "email_1", email_address: "other@example.com" },
        { id: "email_2", email_address: "primary@example.com" },
      ],
    });

    expect(args).toEqual({
      clerkId: "user_123",
      email: "primary@example.com",
      firstName: "Ava",
      lastName: "Stone",
      avatarUrl: "https://cdn.test/avatar.png",
    });
  });

  it("falls back to deterministic placeholder email when missing", () => {
    const args = mapClerkUserToUpsertArgs({
      id: "user_123",
      email_addresses: [],
    });

    expect(args.email).toBe("user_123@clerk.local");
  });

  it("normalizes user deletion payload", () => {
    const args = mapClerkUserToDeleteArgs({
      id: "user_123",
    });

    expect(args).toEqual({
      clerkId: "user_123",
    });
  });
});
