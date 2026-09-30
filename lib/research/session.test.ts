// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { ConvexReactClient } from "convex/react";
import { getFunctionName } from "convex/server";
import { ResearchSession } from "./session";
import type { ResearchCommand } from "./records";

vi.mock("./migrate", () => ({ migrateLocalResearch: async () => [], ResearchImportError: class extends Error {} }));

function connection() {
  const ratings: Array<{ paperId: string; rating: number }> = [];
  const updates = new Set<() => void>();
  const commands: ResearchCommand[] = [];
  const client = {
    watchQuery(query: Parameters<typeof getFunctionName>[0]) {
      return {
        localQueryResult: () => ({ page: getFunctionName(query).endsWith(":ratings") ? [...ratings] : [], isDone: true, continueCursor: "" }),
        onUpdate: (update: () => void) => { updates.add(update); return () => { updates.delete(update); }; },
      };
    },
    mutation: vi.fn(async (_query: unknown, args: { command: ResearchCommand }) => {
      commands.push(args.command);
      if (args.command.kind === "rating") {
        if (args.command.rating === 6) throw new Error("Invalid rating");
        ratings.push({ paperId: args.command.paperId, rating: args.command.rating! });
      }
      for (const update of updates) update();
      return null;
    }),
  };
  return { client: client as unknown as ConvexReactClient, commands };
}

describe("research save recovery", () => {
  it("rolls back a rejected save and still persists the next change", async () => {
    const { client, commands } = connection();
    const errors: Error[] = [];
    const session = new ResearchSession(client, "alice", error => errors.push(error));
    const stop = session.subscribe(() => {});
    await vi.waitFor(() => expect(session.getSnapshot().ready).toBe(true));
    session.stores.ratings.getState().setRating("bad", 6);
    session.stores.ratings.getState().setRating("good", 4);
    await vi.waitFor(() => expect(session.getSnapshot().pending).toBe(0));
    expect(commands).toHaveLength(2);
    expect(errors[0].message).toBe("Invalid rating");
    expect(session.stores.ratings.getState().ratings).toEqual({ good: 4 });
    stop();
  });

  it("queues edits while account authentication loads and retains them across subscriptions", async () => {
    const { client, commands } = connection();
    const session = new ResearchSession(client, "alice");
    const stop = session.subscribe(() => {}, false);
    session.stores.ratings.getState().setRating("W1", 5);
    expect(commands).toEqual([]);
    expect(session.getSnapshot().pending).toBe(1);
    stop();
    const resume = session.subscribe(() => {}, true);
    await vi.waitFor(() => expect(session.getSnapshot().pending).toBe(0));
    expect(commands).toEqual([{ kind: "rating", paperId: "W1", rating: 5 }]);
    expect(session.stores.ratings.getState().ratings.W1).toBe(5);
    resume();
  });
});
