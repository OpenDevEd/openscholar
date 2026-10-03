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

  it("keeps a search a page just made readable until Convex has read it back", async () => {
    // What `getSearch` has: undefined while the page's read of the new search is on its way.
    let read: ResearchCommand | null | undefined;
    let save = () => {};
    const updates = new Set<() => void>();
    const client = {
      watchQuery(query: Parameters<typeof getFunctionName>[0]) {
        return {
          localQueryResult: () => (getFunctionName(query).endsWith(":getSearch") ? (read?.kind === "createSearch" ? read.search : read) : { page: [], isDone: true, continueCursor: "" }),
          onUpdate: (update: () => void) => { updates.add(update); return () => { updates.delete(update); }; },
        };
      },
      mutation: vi.fn(() => new Promise<null>(resolve => { save = () => resolve(null); })),
    } as unknown as ConvexReactClient;
    const session = new ResearchSession(client, "alice");
    const stop = session.subscribe(() => {});
    await vi.waitFor(() => expect(session.getSnapshot().ready).toBe(true));

    const history = session.stores.history.getState();
    const id = history.addSearchResult({ query: "tutoring", field: "title", count: 1 });
    const unwatch = session.watchSearch(id, () => {});
    expect(session.watchedStatus(id)).toBe("found");

    // The save lands before the page's read of the search does.
    await vi.waitFor(() => expect(client.mutation).toHaveBeenCalled());
    const created = vi.mocked(client.mutation).mock.calls[0][1] as { command: ResearchCommand };
    save();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(session.watchedStatus(id)).toBe("found");
    expect(history.getSearchResult(id)?.query).toBe("tutoring");

    read = created.command;
    for (const update of updates) update();
    await vi.waitFor(() => expect(session.getSnapshot().pending).toBe(0));
    expect(session.watchedStatus(id)).toBe("found");
    expect(history.getSearchResult(id)?.query).toBe("tutoring");
    unwatch();
    stop();
  });

  it("shows a search a list handed over at once, then what Convex has of it", async () => {
    let read: unknown;
    const updates = new Set<() => void>();
    const client = {
      watchQuery(query: Parameters<typeof getFunctionName>[0]) {
        return {
          localQueryResult: () => (getFunctionName(query).endsWith(":getSearch") ? read : { page: [], isDone: true, continueCursor: "" }),
          onUpdate: (update: () => void) => { updates.add(update); return () => { updates.delete(update); }; },
        };
      },
      mutation: vi.fn(async () => null),
    } as unknown as ConvexReactClient;
    const session = new ResearchSession(client, "alice");
    const stop = session.subscribe(() => {});
    const listed = { id: "listed", query: "tutoring", field: "title" as const, count: 3, queryHistoryCount: 1, questionCount: 0, questionText: "", screeningQuestions: [{ question: "Randomized?" }], screeningResponses: [], createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };

    const unwatch = session.watchSearch("listed", () => {}, listed);
    expect(session.watchedStatus("listed")).toBe("found");
    expect(session.stores.history.getState().getSearchResult("listed")).toMatchObject({ query: "tutoring", screeningResponses: {} });

    read = { ...listed, screeningResponses: [{ paperId: "W1", responses: [{ question: "Randomized?", response: true }] }] };
    for (const update of updates) update();
    expect(session.stores.history.getState().getSearchResult("listed")?.screeningResponses).toEqual({ W1: { "Randomized?": true } });
    unwatch();
    stop();
  });

  it("says when a search's read failed, saves other changes meanwhile, and reads it again on Retry", async () => {
    let failing = true;
    const updates = new Set<() => void>();
    const client = {
      watchQuery(query: Parameters<typeof getFunctionName>[0]) {
        return {
          localQueryResult: () => {
            if (!getFunctionName(query).endsWith(":getSearch")) return { page: [], isDone: true, continueCursor: "" };
            if (failing) throw new Error("Server Error");
            return null;
          },
          onUpdate: (update: () => void) => { updates.add(update); return () => { updates.delete(update); }; },
        };
      },
      mutation: vi.fn(async () => null),
    } as unknown as ConvexReactClient;
    const session = new ResearchSession(client, "alice");
    const stop = session.subscribe(() => {});
    await vi.waitFor(() => expect(session.getSnapshot().ready).toBe(true));

    const told = vi.fn();
    const unwatch = session.watchSearch("gone", told);
    expect(session.watchedStatus("gone")).toBe("failed");
    session.stores.ratings.getState().setRating("W1", 4);
    await vi.waitFor(() => expect(session.getSnapshot().pending).toBe(0));

    failing = false;
    session.retry();
    expect(told).toHaveBeenCalled();
    expect(session.watchedStatus("gone")).toBe("missing");
    unwatch();
    stop();
  });
});
