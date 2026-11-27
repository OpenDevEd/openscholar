import { describe, expect, it } from "vitest";
import { project, type PaperState, type Place } from "./project";

const paper: PaperState = { id: "p1", place: 0, result: "waiting", held: false, away: [] };
const criteria = [{ key: "c1", must: true }];
const cast = (reviewer: string, kind: Place["kind"], decision: "include" | "exclude", at: number): Place => ({ reviewer, kind, status: "cast", decision, at, ...(kind === "model" ? { answers: { c1: decision === "include" ? "yes" : "no" } } : {}) });
const waiting = (reviewer: string, kind: Place["kind"]): Place => ({ reviewer, kind, status: "waiting" });

describe("project", () => {
  it("waits for someone invited by email before the rule settles a paper", () => {
    const team = { people: ["ann"], models: [], invited: 1 };
    const rule = { each: 2, settle: "all" as const };
    expect(project(paper, [cast("ann", "person", "include", 1)], team, rule, criteria, { models: false }).result).toBe("waiting");
    expect(project(paper, [cast("ann", "person", "include", 1)], { ...team, invited: 0 }, rule, criteria, { models: false }).result).toBe("include");
  });

  it("doesn't let a model settle papers nobody it waits for has joined to read", () => {
    const team = { people: [], models: ["m"], invited: 1 };
    expect(project(paper, [cast("m", "model", "exclude", 1)], team, { each: 1, settle: "one" }, criteria, { models: false }).result).toBe("waiting");
  });

  it("closes a model's place once a person's first vote settles the paper", () => {
    const team = { people: ["ann"], models: ["m"] };
    const after = project(paper, [cast("ann", "person", "include", 1), waiting("m", "model")], team, { each: 1, settle: "one" }, criteria, { models: false });
    expect(after.result).toBe("include");
    expect(after.closed.map((place) => place.reviewer)).toEqual(["m"]);
  });

  it("closes an advising model's place once its people settle the paper", () => {
    const team = { people: ["ann"], models: ["m"] };
    const after = project(paper, [cast("ann", "person", "include", 1), waiting("m", "model")], team, { each: 1, settle: "all", models: "advice" }, criteria, { models: false });
    expect(after.result).toBe("include");
    expect(after.closed.map((place) => place.reviewer)).toEqual(["m"]);
  });

  it("gives nobody new a split that everyone has to agree on", () => {
    const split = { ...paper, result: "conflict" as const };
    const team = { people: ["ann", "ben", "cat"], models: [] };
    const after = project(split, [cast("ann", "person", "include", 1), cast("ben", "person", "exclude", 2)], team, { each: "all", settle: "all" }, criteria, { models: false });
    expect(after.result).toBe("conflict");
    expect(after.made).toEqual([]);
  });
});
