import { describe, expect, it, vi } from "vitest";
import { processClerkWebhookEvent } from "../convex/webhooks/clerk";

describe("clerk webhook handler", () => {
  it("dispatches user.created to upsert mutation", async () => {
    const mutationRefs = {
      upsertUserFromClerk: Symbol("upsertUserFromClerk"),
      markUserDeletedFromClerk: Symbol("markUserDeletedFromClerk"),
    };
    const runMutation = vi
      .fn()
      .mockImplementation(async (mutation: unknown, _args: unknown) => {
        if (mutation !== mutationRefs.upsertUserFromClerk) {
          throw new Error("expected upsertUserFromClerk mutation");
        }
        return null;
      });

    const outcome = await processClerkWebhookEvent({
      eventId: "evt_1",
      eventType: "user.created",
      data: {
        id: "user_123",
        first_name: "Ava",
        last_name: "Stone",
        image_url: "https://cdn.example/avatar.png",
        primary_email_address_id: "email_1",
        email_addresses: [{ id: "email_1", email_address: "ava@example.com" }],
      },
      runMutation,
      mutationRefs,
    });

    expect(outcome).toEqual({ status: 200, body: "OK" });
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      clerkId: "user_123",
      email: "ava@example.com",
      firstName: "Ava",
      lastName: "Stone",
      avatarUrl: "https://cdn.example/avatar.png",
    });
  });

  it("dispatches user.updated to upsert mutation", async () => {
    const mutationRefs = {
      upsertUserFromClerk: Symbol("upsertUserFromClerk"),
      markUserDeletedFromClerk: Symbol("markUserDeletedFromClerk"),
    };
    const runMutation = vi
      .fn()
      .mockImplementation(async (mutation: unknown, _args: unknown) => {
        if (mutation !== mutationRefs.upsertUserFromClerk) {
          throw new Error("expected upsertUserFromClerk mutation");
        }
        return null;
      });

    const outcome = await processClerkWebhookEvent({
      eventId: "evt_2",
      eventType: "user.updated",
      data: {
        id: "user_123",
        email_addresses: [{ id: "email_1", email_address: "ava@example.com" }],
      },
      runMutation,
      mutationRefs,
    });

    expect(outcome).toEqual({ status: 200, body: "OK" });
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      clerkId: "user_123",
      email: "ava@example.com",
      firstName: undefined,
      lastName: undefined,
      avatarUrl: undefined,
    });
  });

  it("dispatches user.deleted to delete mutation", async () => {
    const mutationRefs = {
      upsertUserFromClerk: Symbol("upsertUserFromClerk"),
      markUserDeletedFromClerk: Symbol("markUserDeletedFromClerk"),
    };
    const runMutation = vi
      .fn()
      .mockImplementation(async (mutation: unknown, _args: unknown) => {
        if (mutation !== mutationRefs.markUserDeletedFromClerk) {
          throw new Error("expected markUserDeletedFromClerk mutation");
        }
        return null;
      });

    const outcome = await processClerkWebhookEvent({
      eventId: "evt_3",
      eventType: "user.deleted",
      data: { id: "user_123" },
      runMutation,
      mutationRefs,
    });

    expect(outcome).toEqual({ status: 200, body: "OK" });
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({ clerkId: "user_123" });
  });

  it("returns 200 for unknown events and does not mutate", async () => {
    const runMutation = vi.fn().mockResolvedValue(null);

    const outcome = await processClerkWebhookEvent({
      eventId: "evt_4",
      eventType: "session.created",
      data: { id: "sess_123" },
      runMutation,
    });

    expect(outcome).toEqual({ status: 200, body: "OK" });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed user payload", async () => {
    const runMutation = vi.fn().mockResolvedValue(null);

    const outcome = await processClerkWebhookEvent({
      eventId: "evt_5",
      eventType: "user.updated",
      data: { foo: "bar" },
      runMutation,
    });

    expect(outcome).toEqual({ status: 400, body: "Invalid user payload" });
    expect(runMutation).not.toHaveBeenCalled();
  });
});
