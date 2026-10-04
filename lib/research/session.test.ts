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
        localQueryResult: () => ({ page: getFunctionName(query).endsWith(":ratingsOf") ? [...ratings] : [], isDone: true, continueCursor: "" }),
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
  it("validates the whole upload before queuing any search writes", () => {
    const { client, commands } = connection();
    const session = new ResearchSession(client, "alice");
    expect(() => session.stores.history.getState().importSearchHistory([
      { search_query: "reading", count: "0", field: "title" },
      { search_query: "writing", count: "invalid", field: "title" },
    ])).toThrow(/count/);
    expect(session.getSnapshot().pending).toBe(0);
    expect(commands).toEqual([]);
  });
  it("rolls back a rejected save and still persists the next change", async () => {
    const { client, commands } = connection();
    const errors: Error[] = [];
    const session = new ResearchSession(client, "alice", error => errors.push(error));
    const stop = session.subscribe(() => {});
    await vi.waitFor(() => expect(session.getSnapshot().ready).toBe(true));
    const unwatch = session.watchRatings(["bad", "good"], () => {});
    session.stores.ratings.getState().setRating("bad", 6);
    session.stores.ratings.getState().setRating("good", 4);
    await vi.waitFor(() => expect(session.getSnapshot().pending).toBe(0));
    expect(commands).toHaveLength(2);
    expect(errors[0].message).toBe("Invalid rating");
    expect(session.stores.ratings.getState().ratings).toEqual({ good: 4 });
    // Once no page shows those papers, the browser stops holding their ratings.
    unwatch();
    await Promise.resolve();
    expect(session.stores.ratings.getState().ratings).toEqual({});
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
    const unwatch = session.watchRatings(["W1"], () => {});
    await vi.waitFor(() => expect(session.getSnapshot().pending).toBe(0));
    expect(commands).toEqual([{ kind: "rating", paperId: "W1", rating: 5 }]);
    expect(session.stores.ratings.getState().ratings.W1).toBe(5);
    unwatch();
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
          localQueryResult: () => (getFunctionName(query).endsWith(":getSearch") ? read : getFunctionName(query).endsWith(":answersOf") ? answers : { page: [], isDone: true, continueCursor: "" }),
          onUpdate: (update: () => void) => { updates.add(update); return () => { updates.delete(update); }; },
        };
      },
      mutation: vi.fn(async () => null),
    } as unknown as ConvexReactClient;
    let answers: unknown;
    const session = new ResearchSession(client, "alice");
    const stop = session.subscribe(() => {});
    const listed = { id: "listed", query: "tutoring", field: "title" as const, count: 3, queryHistoryCount: 1, questionCount: 0, questionText: "", screeningQuestions: [{ question: "Randomized?" }], screeningResponses: [], createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };

    const unwatch = session.watchSearch("listed", () => {}, listed);
    expect(session.watchedStatus("listed")).toBe("found");
    expect(session.stores.history.getState().getSearchResult("listed")).toMatchObject({ query: "tutoring", screeningResponses: {} });

    // Its answers are read apart, for the papers its page shows.
    read = { ...listed, count: 4 };
    const unanswer = session.watchAnswers("listed", ["W1", "W2"], () => {});
    expect(session.answersRead("listed", ["W1", "W2"])).toBe(0);
    answers = { page: [{ paperId: "W1", responses: [{ question: "Randomized?", response: true }] }], isDone: true, continueCursor: "" };
    for (const update of updates) update();
    expect(session.answersRead("listed", ["W1", "W2"])).toBe(2);
    expect(session.stores.history.getState().getSearchResult("listed")).toMatchObject({ count: 4, screeningResponses: { W1: { "Randomized?": true } } });
    unanswer();
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

  it("says when a search's answers couldn't be read, and that they're known once a Retry reads them (#421)", async () => {
    let failing = true;
    const updates = new Set<() => void>();
    const client = {
      watchQuery(query: Parameters<typeof getFunctionName>[0]) {
        return {
          localQueryResult: () => {
            if (getFunctionName(query).endsWith(":answersOf") && failing) throw new Error("Server Error");
            return { page: [], isDone: true, continueCursor: "" };
          },
          onUpdate: (update: () => void) => { updates.add(update); return () => { updates.delete(update); }; },
        };
      },
      mutation: vi.fn(async () => null),
    } as unknown as ConvexReactClient;
    const session = new ResearchSession(client, "alice");
    const stop = session.subscribe(() => {});
    const unwatch = session.watchAnswers("search", ["W1", "W2"], () => {});
    // The papers can show, but what they're answered isn't known, so nothing should screen them.
    expect(session.answersRead("search", ["W1", "W2"])).toBe(2);
    expect(session.answersFailed("search", ["W1", "W2"])).toBe(true);

    failing = false;
    session.retry();
    expect(session.answersFailed("search", ["W1", "W2"])).toBe(false);
    unwatch();
    stop();
  });

  it("reads a download's answers from a search still being saved (#421)", async () => {
    const client = {
      watchQuery: () => ({ localQueryResult: () => ({ page: [], isDone: true, continueCursor: "" }), onUpdate: () => () => {} }),
      // The search isn't on the account yet.
      query: vi.fn(async () => ({ page: [], isDone: true, continueCursor: "" })),
      mutation: vi.fn(() => new Promise(() => {})),
    } as unknown as ConvexReactClient;
    const session = new ResearchSession(client, "alice");
    const stop = session.subscribe(() => {});
    await vi.waitFor(() => expect(session.getSnapshot().ready).toBe(true));
    const history = session.stores.history.getState();
    history.importSearchHistory([{ id: "imported", query: "tutoring", field: "title", count: 1, screeningQuestions: [{ question: "Randomized?" }], screeningResponses: { W1: { "Randomized?": true }, W2: { "Randomized?": false } }, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" }]);
    history.setScreeningResponse("imported", "W2", "Randomized?", true);

    expect(await session.stores.history.getState().readScreeningResponses("imported", ["W2", "W3"])).toEqual({ W2: { "Randomized?": true } });
    stop();
  });

  it("keeps the ratings a list already read when the list grows, and reads only the papers it gained", async () => {
    const asked: string[][] = [];
    const stopped = vi.fn();
    const client = {
      watchQuery(query: Parameters<typeof getFunctionName>[0], args: { paperIds?: string[] }) {
        if (args.paperIds) asked.push(args.paperIds);
        return {
          localQueryResult: () => ({ page: (args.paperIds ?? []).filter(id => id === "W2").map(paperId => ({ paperId, rating: 3 })), isDone: true, continueCursor: "" }),
          onUpdate: () => (args.paperIds ? stopped : () => {}),
        };
      },
      // The save stays on its way, so the download below reads while it's pending.
      mutation: vi.fn(() => new Promise<null>(() => {})),
      query: vi.fn(async (_query: unknown, args: { paperIds: string[] }) => ({ page: args.paperIds.filter(id => id === "W2").map(paperId => ({ paperId, rating: 3 })), isDone: true, continueCursor: "" })),
    } as unknown as ConvexReactClient;
    const session = new ResearchSession(client, "alice");
    const stop = session.subscribe(() => {});
    await vi.waitFor(() => expect(session.getSnapshot().ready).toBe(true));

    // A list that names a paper twice still holds one read of it.
    const first = session.watchRatings(["W1", "W2", "W1"], () => {});
    expect(asked).toEqual([["W1", "W2"]]);
    // Show more: the page lets go of the old list and takes the longer one in the same moment.
    first();
    const second = session.watchRatings(["W1", "W2", "W3"], () => {});
    expect(asked).toEqual([["W1", "W2"], ["W3"]]);
    expect(session.ratingsRead(["W1", "W2", "W3"])).toBe(3);
    await Promise.resolve();
    expect(stopped).not.toHaveBeenCalled();
    expect(session.stores.ratings.getState().ratings).toEqual({ W2: 3 });

    // A download reads the ratings itself, with a change still being saved.
    session.stores.ratings.getState().setRating("W9", 5);
    expect(await session.stores.ratings.getState().readRatings(["W2", "W9", "W4"])).toEqual({ W2: 3, W9: 5 });

    second();
    await Promise.resolve();
    expect(stopped).toHaveBeenCalledTimes(2);
    expect(session.ratingsRead(["W1"])).toBe(0);
    stop();
  });

  it("expands only the shortcuts it has read by name, and an upload keeps a name already taken", async () => {
    const saved = [{ shorthand: "rct", expansion: "randomized controlled trial", createdAt: 1 }];
    const asked: string[][] = [];
    const commands: ResearchCommand[] = [];
    const client = {
      watchQuery(_query: unknown, args: { names?: string[] }) {
        if (args.names) asked.push(args.names);
        return { localQueryResult: () => ({ page: saved.filter(row => args.names?.includes(row.shorthand)), isDone: true, continueCursor: "" }), onUpdate: () => () => {} };
      },
      mutation: vi.fn(async (_query: unknown, args: { command: ResearchCommand }) => { commands.push(args.command); return null; }),
    } as unknown as ConvexReactClient;
    const session = new ResearchSession(client, "alice");
    const stop = session.subscribe(() => {});
    await vi.waitFor(() => expect(session.getSnapshot().ready).toBe(true));
    const shortcuts = session.stores.shortcuts.getState();

    // Nothing is read until a query names it.
    expect(asked).toEqual([]);
    expect(shortcuts.expandQuery("rct... AND reading").warnings).toHaveLength(1);
    await shortcuts.ensureShortcuts(["rct", "nope"]);
    expect(asked).toEqual([["rct", "nope"]]);
    expect(shortcuts.expandQuery("rct... AND reading")).toEqual({ expandedQuery: "randomized controlled trial AND reading", warnings: [] });
    expect(shortcuts.expandQuery("nope... AND reading").warnings).toEqual([{ key: "bookmarkNotFound", params: { keyword: "nope" } }]);

    expect(await shortcuts.importKeywords([{ name: "rct", expansion: "something else" }, { name: "ml", expansion: "machine learning", createdAt: 5 }, { name: "ml", expansion: "twice" }, { name: "", expansion: "no name" }])).toBe(1);
    await vi.waitFor(() => expect(session.getSnapshot().pending).toBe(0));
    expect(commands).toEqual([{ kind: "shortcut", shorthand: "ml", value: { expansion: "machine learning", createdAt: 5 } }]);
    stop();
  });

  it("refuses to go on when a shortcut couldn't be looked up, keeps a slow lookup waiting, and clears in turn with the saves around it", async () => {
    vi.useFakeTimers();
    try {
      let answer: "slow" | "fail" | "ready" = "slow";
      const updates = new Set<() => void>();
      const stopped = vi.fn();
      const commands: ResearchCommand[] = [];
      const client = {
        watchQuery(_query: unknown, args: { names?: string[] }) {
          return {
            localQueryResult: () => {
              if (!args.names || answer === "ready") return { page: [], isDone: true, continueCursor: "" };
              if (answer === "fail") throw new Error("Server Error");
              return undefined;
            },
            onUpdate: (update: () => void) => { updates.add(update); return () => { updates.delete(update); if (args.names) stopped(); }; },
          };
        },
        mutation: vi.fn(async (_query: unknown, args: { command: ResearchCommand }) => { commands.push(args.command); return null; }),
      } as unknown as ConvexReactClient;
      const session = new ResearchSession(client, "alice");
      const stop = session.subscribe(() => {});
      await vi.waitFor(() => expect(session.getSnapshot().ready).toBe(true));
      const shortcuts = session.stores.shortcuts.getState();

      // A lookup that takes longer than its keep-alive still holds its read and still answers.
      const slow = shortcuts.ensureShortcuts(["rct"]);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(stopped).not.toHaveBeenCalled();
      answer = "ready";
      for (const update of updates) update();
      await expect(slow).resolves.toBeUndefined();

      // Two holders of one read: whichever lets go last, the name can be looked up again.
      const first = session.watchShortcuts(["ml"], () => {});
      const second = session.watchShortcuts(["ml"], () => {});
      first();
      second();
      await vi.advanceTimersByTimeAsync(0);
      session.watchShortcuts(["ml"], () => {})();

      // A lookup that failed doesn't pass for "no such shortcut".
      answer = "fail";
      await expect(shortcuts.ensureShortcuts(["taken"])).rejects.toThrow("couldn't be read");
      await expect(shortcuts.importKeywords([{ name: "taken", expansion: "would overwrite" }])).rejects.toThrow("couldn't be read");

      shortcuts.addKeyword("one", "first");
      shortcuts.addKeyword("two", "second");
      shortcuts.clearKeywords();
      expect(session.stores.shortcuts.getState().keywords).toEqual({});
      await vi.waitFor(() => expect(session.getSnapshot().pending).toBe(0));
      expect(commands.map(command => command.kind === "shortcut" ? command.shorthand : command.kind)).toEqual(["one", "two", "clearShortcuts"]);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
