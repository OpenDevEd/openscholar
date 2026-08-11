/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { setupTransactionAggregates } from "../credits/aggregates.test-support";
import {
  applyUserDeleteProjection,
  applyUserUpsertProjection,
} from "./internal";

function metadata(eventId: string, occurredAt: number) {
  return {
    entityId: "user_123",
    entityType: "user" as const,
    eventId,
    eventType: "user.updated",
    instanceId: "ins_123",
    occurredAt,
    payloadSha256: eventId.padEnd(64, "a"),
    processedAt: occurredAt * 1_000,
  };
}

describe("Clerk user projection ordering", () => {
  it("keeps a user deleted when an older update arrives later", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);

    const created = await t.run((ctx) =>
      applyUserUpsertProjection(ctx, {
        ...metadata("msg_create", 100),
        email: "original@example.com",
        firstName: "Original",
        clerkId: "user_123",
      }),
    );
    const deleted = await t.run((ctx) =>
      applyUserDeleteProjection(ctx, {
        ...metadata("msg_delete", 102),
        eventType: "user.deleted",
        clerkId: "user_123",
      }),
    );
    const delayed = await t.run((ctx) =>
      applyUserUpsertProjection(ctx, {
        ...metadata("msg_delayed", 101),
        email: "delayed@example.com",
        firstName: "Delayed",
        clerkId: "user_123",
      }),
    );
    const replay = await t.run((ctx) =>
      applyUserDeleteProjection(ctx, {
        ...metadata("msg_delete", 102),
        eventType: "user.deleted",
        clerkId: "user_123",
      }),
    );
    const user = await t.run((ctx) =>
      ctx.db
        .query("users")
        .withIndex("by_clerk_id", (query) => query.eq("clerkId", "user_123"))
        .unique(),
    );

    expect([created, deleted, delayed, replay]).toEqual([
      "applied",
      "applied",
      "stale",
      "duplicate",
    ]);
    expect(user).toMatchObject({
      email: "original@example.com",
      firstName: "Original",
      state: "deleted",
    });
  });
});
