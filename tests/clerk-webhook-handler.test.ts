import { describe, expect, it, vi } from "vitest";
import { processClerkWebhookEvent } from "../convex/webhooks/clerk";

const signedEventMetadata = {
  instanceId: "ins_123",
  occurredAt: 1_700_000_000,
  payloadSha256: "a".repeat(64),
};

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
      ...signedEventMetadata,
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
      eventId: "evt_1",
      eventType: "user.created",
      ...signedEventMetadata,
      clerkId: "user_123",
      email: "ava@example.com",
      verifiedEmails: [],
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
      ...signedEventMetadata,
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
      eventId: "evt_2",
      eventType: "user.updated",
      ...signedEventMetadata,
      clerkId: "user_123",
      email: "ava@example.com",
      verifiedEmails: [],
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
      ...signedEventMetadata,
      eventType: "user.deleted",
      data: { id: "user_123" },
      runMutation,
      mutationRefs,
    });

    expect(outcome).toEqual({ status: 200, body: "OK" });
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      eventId: "evt_3",
      eventType: "user.deleted",
      ...signedEventMetadata,
      clerkId: "user_123",
    });
  });

  it("returns 200 for unknown events and does not mutate", async () => {
    const runMutation = vi.fn().mockResolvedValue(null);

    const outcome = await processClerkWebhookEvent({
      eventId: "evt_4",
      ...signedEventMetadata,
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
      ...signedEventMetadata,
      eventType: "user.updated",
      data: { foo: "bar" },
      runMutation,
    });

    expect(outcome).toEqual({ status: 400, body: "Invalid user payload" });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it.each([
    ["organization.created", "upsert", "organization"],
    ["organization.updated", "upsert", "organization"],
    ["organization.deleted", "delete", "organization"],
    ["organizationMembership.created", "upsert", "membership"],
    ["organizationMembership.updated", "upsert", "membership"],
    ["organizationMembership.deleted", "delete", "membership"],
  ] as const)("dispatches %s to its projection mutation", async (eventType, action, kind) => {
    const mutationRefs = {
      applyOrganizationEvent: Symbol("applyOrganizationEvent"),
      applyOrganizationMembershipEvent: Symbol("applyOrganizationMembershipEvent"),
    };
    const organization = {
      id: "org_123",
      name: "Evidence Team",
      slug: "evidence-team",
      created_at: 1_700_000_000_000,
      updated_at: 1_700_000_001_000,
    };
    const data = kind === "organization"
      ? action === "delete"
        ? { id: "org_123", deleted: true }
        : organization
      : {
          id: "orgmem_123",
          role: "org:member",
          created_at: 1_700_000_002_000,
          updated_at: 1_700_000_003_000,
          organization,
          public_user_data: { user_id: "user_123" },
        };
    const runMutation = vi.fn().mockResolvedValue("applied");

    const outcome = await processClerkWebhookEvent({
      eventId: `msg_${eventType}`,
      eventType,
      data,
      ...signedEventMetadata,
      runMutation,
      mutationRefs,
    });

    expect(outcome).toEqual({ status: 200, body: "OK" });
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0]?.[0]).toBe(
      kind === "organization"
        ? mutationRefs.applyOrganizationEvent
        : mutationRefs.applyOrganizationMembershipEvent,
    );
    expect(runMutation.mock.calls[0]?.[1]).toMatchObject({
      action,
      eventId: `msg_${eventType}`,
      eventType,
      instanceId: "ins_123",
      occurredAt: 1_700_000_000,
      payloadSha256: "a".repeat(64),
    });
  });
});
