// A screening's rules (plans/screening-reviewers): each setting against each state of a paper's votes.
import { describe, expect, it } from "vitest";
import { cellOf, decide, emptyMatrix, fillPlaces, firstDeal, kappa, reasonOf, scoreOf, seesVotes, settle, takesOver, type Ballot, type Decision } from "./rules";

const cast = (decision: Decision, at = 1, reason?: string): Ballot => ({ status: "cast", decision, at, ...(reason ? { reason } : {}) });
const waiting: Ballot = { status: "waiting" };
const failed: Ballot = { status: "failed" };

describe("a reviewer's decision from their answers", () => {
  const criteria = [{ key: "a", must: true }, { key: "b", must: true }, { key: "c", must: false }];
  it("excludes on a must-have answered no, and names it", () => expect(decide({ a: "yes", b: "no", c: "yes" }, criteria)).toEqual({ decision: "exclude", reason: "b" }));
  it("is a maybe when a must-have is unclear and none fails", () => expect(decide({ a: "unclear", b: "yes" }, criteria).decision).toBe("maybe"));
  it("includes whatever a nice-to-have says", () => expect(decide({ a: "yes", b: "yes", c: "no" }, criteria).decision).toBe("include"));
  it("lets a failed must-have outrank an unclear one", () => expect(decide({ a: "unclear", b: "no" }, criteria).decision).toBe("exclude"));
});

describe("where a paper stands on its votes", () => {
  it("waits while nobody has voted, under every rule", () => {
    for (const rule of ["all", "most", "one"] as const) expect(settle(rule, [waiting, waiting])).toBe("waiting");
    expect(settle("all", [])).toBe("waiting");
  });
  it("is settled by the earliest vote where the first vote decides, whoever else has still to vote", () => {
    expect(settle("one", [waiting, cast("exclude", 5), cast("include", 2)])).toBe("include");
  });
  it("waits for every reviewer where all or most must agree", () => {
    expect(settle("all", [cast("include"), waiting])).toBe("waiting");
    expect(settle("most", [cast("include"), cast("include"), waiting])).toBe("waiting");
  });
  it("is settled when all agree and in conflict when one doesn't", () => {
    expect(settle("all", [cast("maybe"), cast("maybe")])).toBe("maybe");
    expect(settle("all", [cast("include"), cast("include"), cast("maybe")])).toBe("conflict");
  });
  it("goes with more than half, and an even split has no side", () => {
    expect(settle("most", [cast("exclude"), cast("exclude"), cast("include")])).toBe("exclude");
    expect(settle("most", [cast("exclude"), cast("include")])).toBe("conflict");
    expect(settle("most", [cast("exclude"), cast("include"), cast("maybe")])).toBe("conflict");
  });
  it("gives a model that couldn't read the paper no say, and a thrown-out vote none either", () => {
    expect(settle("all", [cast("include"), failed])).toBe("include");
    expect(settle("all", [cast("include"), { status: "discarded", decision: "exclude", at: 1 }])).toBe("include");
    expect(settle("all", [failed])).toBe("waiting");
  });
  it("counts a place closed when the paper was settled as one nobody voted from", () => {
    expect(settle("all", [cast("include"), { status: "closed" }])).toBe("waiting");
    expect(settle("one", [cast("include"), { status: "closed" }])).toBe("include");
  });
});

describe("the reason an excluded paper is counted under", () => {
  it("is the one most of its reviewers gave, and the settler's when there is one", () => {
    const ballots = [cast("exclude", 1, "a"), cast("exclude", 2, "b"), cast("exclude", 3, "b"), cast("include", 4)];
    expect(reasonOf(ballots)).toBe("b");
    expect(reasonOf(ballots, "other")).toBe("other");
    expect(reasonOf([cast("include")])).toBeUndefined();
  });
});

describe("points and stars", () => {
  it("scores each criterion on the answer most reviewers gave", () => {
    const criteria = [{ key: "a", points: { yes: 2, no: 0, unclear: 1 } }, { key: "b", points: { yes: 1, no: 0, unclear: 0 } }];
    const ballots: Ballot[] = [{ ...cast("include"), answers: { a: "yes", b: "no" } }, { ...cast("include"), answers: { a: "yes", b: "yes" } }, { ...cast("maybe"), answers: { a: "unclear", b: "yes" } }];
    expect(scoreOf(criteria, [1, 2, 3, 4, 5], ballots)).toEqual({ points: 3, of: 3, stars: 3 });
  });
});

describe("who a paper goes to", () => {
  const people = ["a", "b", "c"];
  it("deals each paper to as many people as the rule asks for, in turn, so the work is even", () => {
    const dealt = Array.from({ length: 30 }, (_, place) => firstDeal(people, 2, place)).flat();
    for (const person of people) expect(dealt.filter((one) => one === person)).toHaveLength(20);
    expect(firstDeal(people, "all", 4)).toHaveLength(3);
    expect(firstDeal(people, 5, 0)).toHaveLength(3);
    expect(firstDeal(people, 0, 0)).toEqual([]);
    expect(firstDeal([], 2, 0)).toEqual([]);
  });
  it("fills a free place with someone not on the paper, and gives it back to who it was moved from only as a last resort", () => {
    const team = people.map((id) => ({ id }));
    expect(fillPlaces(team, ["a"], ["b"], 1, 0).map((one) => one.id)).toEqual(["c"]);
    expect(fillPlaces(team, ["a", "c"], ["b"], 1, 0).map((one) => one.id)).toEqual(["b"]);
    expect(fillPlaces(team, ["a", "b", "c"], [], 2, 0)).toEqual([]);
  });
  it("gives someone who joins an even share of the places nobody voted from", () => {
    // Three people before them, two places a paper: they take over a place on about half the papers (2 in 4).
    const taken = Array.from({ length: 4000 }, (_, i) => takesOver(`paper${i}`, "new", 3, 2)).filter((place) => place !== null);
    expect(taken.length).toBeGreaterThan(1800);
    expect(taken.length).toBeLessThan(2200);
    expect(takesOver("paper", "new", 3, 0)).toBeNull();
  });
});

describe("who sees the other votes", () => {
  it("hides them only on a paper that still waits for the person's own vote", () => {
    expect(seesVotes("after", "waiting", "waiting")).toBe(false);
    expect(seesVotes("after", "waiting", "cast")).toBe(true);
    expect(seesVotes("after", "waiting", undefined)).toBe(true);
    expect(seesVotes("after", "include", "closed")).toBe(true);
    expect(seesVotes("after", "conflict", "cast")).toBe(true);
    expect(seesVotes("always", "waiting", "waiting")).toBe(true);
  });
});

describe("agreement between two reviewers", () => {
  it("is Cohen's kappa over the papers both voted on", () => {
    const matrix = emptyMatrix();
    for (const [first, second, n] of [["include", "include", 20], ["exclude", "exclude", 15], ["include", "exclude", 5], ["exclude", "include", 10]] as const) matrix[cellOf(first, second)]! += n;
    const figure = kappa(matrix)!;
    expect(figure.papers).toBe(50);
    expect(figure.same).toBeCloseTo(0.7);
    expect(figure.kappa).toBeCloseTo(0.4);
    expect(kappa(emptyMatrix())).toBeNull();
  });
});
