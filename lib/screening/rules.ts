// A screening's rules, with nothing of Convex or React in them: how a reviewer's answers become a
// vote, how a paper's votes become its result, who a paper goes to, and how two reviewers agree.
// The server settles papers with these, and the pages say what a change would do with the same ones.

export type Answer = "yes" | "no" | "unclear";
export const ANSWERS: Answer[] = ["yes", "no", "unclear"];
/** A model's answer to a criterion as an answer: true, false, or one it couldn't give. */
export const answerOf = (value: boolean | null): Answer => (value === true ? "yes" : value === false ? "no" : "unclear");
export type Decision = "include" | "maybe" | "exclude";
/** Where a paper stands: settled one way, split between its reviewers, or still short of votes. */
export type Result = Decision | "conflict" | "waiting";
export const DECISIONS: Decision[] = ["include", "maybe", "exclude"];
export const RESULTS: Result[] = ["include", "maybe", "exclude", "conflict", "waiting"];
export const isFinal = (result: Result | undefined): result is Decision => result === "include" || result === "maybe" || result === "exclude";

export type Criterion = {
  key: string;
  text: string;
  short: string;
  must: boolean;
  /** Guidance for whoever answers it, a person or a model: what counts and what doesn't. */
  note?: string;
  /** Words the organiser marked, shown in the abstract while a person votes. */
  terms: string[];
  addedAt: number;
  /** What each answer is worth. Points only make stars: no vote follows from them. */
  points: Record<Answer, number>;
};

export type Rule = {
  /** How many people read each paper: a number, or everyone on the screening, whoever joins later included. */
  each: number | "all";
  /** When a paper is settled: every reviewer agrees, most of them do, or the first vote decides. */
  settle: "all" | "most" | "one";
  /** Who settles a split. */
  resolver: string;
  /** When people see the other votes on a paper. */
  blind: "after" | "always";
  /** How a model's vote counts on a paper a person has: as one reviewer's, or as advice beside the people's, which settle it. Left out, as one reviewer's. */
  models?: "vote" | "advice";
};

/** How long a criterion's short name can be. */
export const SHORT_NAME_LENGTH = 40;
/** The longest note on a vote or a settled result: the fields stop there, and the server refuses longer. */
export const NOTE_LENGTH = 2_000;
/** The short name a criterion has until someone writes one: its question's own words, cut where they run longer than a short name can be. */
export const shortOf = (text: string) => {
  const words = text.replace(/[?.]$/, "").trim();
  return words.length > SHORT_NAME_LENGTH ? `${words.slice(0, SHORT_NAME_LENGTH - 1).trimEnd()}…` : words;
};

/** Why a paper is excluded when no criterion is the reason. */
export const OTHER_REASONS = ["duplicate", "other"] as const;
/** The reason written in a note rather than picked: "another reason". */
export const OTHER_REASON = "other" satisfies (typeof OTHER_REASONS)[number];
/** An exclusion nobody gave a reason for: a title and abstract can be excluded with none. It is counted under its own name, never as "another reason". */
export const NO_REASON = "unstated";
/** Every reason that is not a criterion, as a page or a file names it. */
export const NAMED_REASONS = [...OTHER_REASONS, NO_REASON] as const;

/** A reviewer's decision, from their answers: a must-have criterion answered no excludes, an unclear one leaves it open. */
export function decide(answers: Record<string, Answer>, criteria: Pick<Criterion, "key" | "must">[]): { decision: Decision; reason?: string } {
  const failed = criteria.find((criterion) => criterion.must && answers[criterion.key] === "no");
  if (failed) return { decision: "exclude", reason: failed.key };
  return { decision: criteria.some((criterion) => criterion.must && answers[criterion.key] === "unclear") ? "maybe" : "include" };
}

/**
 * One reviewer's place on a paper. `waiting` and `closed` are places nobody has voted from yet, `failed` is a model
 * that couldn't read the paper and has no say in it, and `discarded` is a vote thrown out with its reviewer.
 */
export type Ballot = { status: "waiting" | "cast" | "failed" | "closed" | "discarded"; decision?: Decision; at?: number; reason?: string; answers?: Record<string, Answer>; /** Whose place it is: under "first vote decides" a person given the paper decides it, not a model. */ kind?: "person" | "model" };

/** Where a paper stands on its votes, under the rule. A person who settled it outranks this, and so does a result held through a change of settings. */
export function settle(rule: Rule["settle"], ballots: Ballot[], models: Rule["models"] = "vote"): Result {
  const held = ballots.filter((one) => one.status === "waiting" || one.status === "cast" || one.status === "closed");
  // With the models' votes as advice, a paper a person has is settled on its people's votes alone.
  const cast = models === "advice" && held.some((one) => one.kind === "person") ? held.filter((one) => one.kind === "person") : held;
  const given = cast.filter((one): one is Ballot & { decision: Decision } => one.status === "cast" && one.decision !== undefined);
  if (!given.length) return "waiting";
  // The first vote is the earliest one cast. Where a person is given the paper it is the first person's: a model reads faster than anyone, and its vote would settle every paper before its people got to one. A model's vote decides only a paper no person has.
  if (rule === "one") {
    const deciding = cast.some((one) => one.kind === "person") ? given.filter((one) => one.kind === "person") : given;
    return deciding.length ? deciding.reduce((first, vote) => ((vote.at ?? 0) < (first.at ?? 0) ? vote : first)).decision : "waiting";
  }
  if (given.length < cast.length) return "waiting";
  const tally = DECISIONS.map((decision) => given.filter((vote) => vote.decision === decision).length);
  const top = Math.max(...tally);
  if (rule === "all") return top === given.length ? given[0]!.decision : "conflict";
  // Most of them: more than half on one side. An even split has no side, and nor has one where the models alone outvote every person on the paper: a person settles that.
  const side = DECISIONS[tally.indexOf(top)]!;
  const people = given.filter((vote) => vote.kind === "person");
  return top * 2 > given.length && (!people.length || people.some((vote) => vote.decision === side)) ? side : "conflict";
}

/** The one reason an excluded paper is counted under: the one its settler gave, else the one most of its reviewers gave. */
export function reasonOf(ballots: Ballot[], settled?: string): string | undefined {
  if (settled) return settled;
  const given = ballots.flatMap((one) => (one.status === "cast" && one.decision === "exclude" && one.reason ? [one.reason] : []));
  return [...new Set(given)].sort((a, b) => given.filter((reason) => reason === b).length - given.filter((reason) => reason === a).length)[0];
}

/** A paper's points and stars, from the answer most of its reviewers gave to each criterion. `stars` holds the points each star starts at. */
export function scoreOf(criteria: Pick<Criterion, "key" | "points">[], stars: number[], ballots: Ballot[]) {
  const points = criteria.reduce((sum, criterion) => {
    const given = ballots.flatMap((one) => (one.status === "cast" ? (one.answers?.[criterion.key] ?? []) : []));
    if (!given.length) return sum;
    const top = ANSWERS.map((answer) => given.filter((one) => one === answer).length);
    return sum + criterion.points[ANSWERS[top.indexOf(Math.max(...top))]!];
  }, 0);
  return { points, of: criteria.reduce((sum, criterion) => sum + Math.max(...ANSWERS.map((answer) => criterion.points[answer])), 0), stars: stars.filter((from) => points >= from).length };
}

/** The points and star thresholds a screening has until someone changes them: a point for each yes, and a star for each fifth of the criteria. */
export const defaultPoints = (): Record<Answer, number> => ({ yes: 1, no: 0, unclear: 0 });
export const defaultStars = (criteria: number) => [1, 2, 3, 4, 5].map((k) => Math.max(1, Math.ceil((k / 5) * criteria)));

/**
 * How two reviewers' votes fell against each other over the papers both voted on: nine counts, the first reviewer's
 * decision by the second's, each in the order of DECISIONS. Kept as papers settle, so agreement is never a pass over them.
 */
export const emptyMatrix = () => Array.from({ length: 9 }, () => 0);
export const cellOf = (first: Decision, second: Decision) => DECISIONS.indexOf(first) * 3 + DECISIONS.indexOf(second);
/** Cohen's kappa from a matrix, with how many papers it counts and the share the two agreed on. Null where they share no paper. */
export function kappa(matrix: number[]) {
  const papers = matrix.reduce((sum, n) => sum + n, 0);
  if (!papers) return null;
  const same = (matrix[0]! + matrix[4]! + matrix[8]!) / papers;
  const chance = DECISIONS.reduce((sum, _, d) => sum + ((matrix[d * 3]! + matrix[d * 3 + 1]! + matrix[d * 3 + 2]!) / papers) * ((matrix[d]! + matrix[d + 3]! + matrix[d + 6]!) / papers), 0);
  // Where both cast one decision every time, chance agreement is total and kappa has no value: the share agreed says it alone.
  return { papers, same, kappa: chance === 1 ? null : (same - chance) / (1 - chance) };
}

/** A number from a text, the same on every run: who gets a paper depends on the paper and the person alone. */
export const hash = (text: string) => [...text].reduce((sum, char) => (Math.imul(sum, 31) + char.charCodeAt(0)) >>> 0, 7);

/** How many people a paper goes to, of the people there are. */
export const readersFor = (each: Rule["each"], people: number) => (each === "all" ? people : Math.min(each, people));
/** Whether the models' votes are only advice where `people` people and `models` models vote on a paper: set so, or under "first vote decides", where a person's vote decides a paper they have. A paper no person has is settled by its models. */
export const modelsAdvise = (rule: Pick<Rule, "settle" | "models">, people: number, models: number) => (rule.models === "advice" || rule.settle === "one") && people > 0 && models > 0;
/** Whether a paper can be in conflict: only where more than one vote settles it. One person, or one person with the models as advice, or "first vote decides", never splits, and nobody need settle anything. */
export const canConflict = (rule: Pick<Rule, "settle" | "models">, people: number, models: number) => rule.settle !== "one" && (modelsAdvise(rule, people, models) ? 0 : models) + people > 1;

/**
 * Who takes the places nobody has voted from on an open paper, when the people or the rule have changed. Whoever
 * holds a place keeps it. Places still free go to the people not on the paper, in the round's order from the paper's
 * place, with anyone the paper was moved away from last: they take it back only where nobody else is left to.
 */
export function fillPlaces<Person extends { id: string }>(people: Person[], on: string[], away: string[], free: number, place: number): Person[] {
  if (free <= 0) return [];
  const round = people.map((_, k) => people[(place + k) % people.length]!).filter((person) => !on.includes(person.id));
  return [...round.filter((person) => !away.includes(person.id)), ...round.filter((person) => away.includes(person.id))].slice(0, free);
}

/**
 * Whether someone who joins takes over a place on a paper, and which: one place in as many as there were people
 * before them, so they end with an even share and nobody else's papers move for any other reason. `waiting` is how
 * many places on the paper nobody has voted from.
 */
export function takesOver(paper: string, person: string, before: number, waiting: number): number | null {
  const claim = hash(`${paper}:${person}`) % (before + 1);
  return claim < waiting ? claim : null;
}

/**
 * Whether someone sees the other votes on a paper, and what was written about it. The votes are kept from a person
 * only while the paper still waits for their own: on a paper that isn't theirs to vote on, on one they have voted on,
 * on one that is settled, in a screening that is finished, where no vote can be cast any more, and wherever the rule
 * says votes show at any time, they see them. One rule, for every page and every file.
 */
export const seesVotes = (blind: Rule["blind"], result: Result | undefined, mine: Ballot["status"] | undefined, finished: boolean) => blind === "always" || finished || isFinal(result) || mine !== "waiting";

/** The papers a reviewer has got through: the ones voted on, and for a model the ones it tried and couldn't read. Every row, sheet and figure of how far someone is counts with this. */
export const gotThrough = (tally: { cast?: number; failed?: number } | undefined) => (tally?.cast ?? 0) + (tally?.failed ?? 0);
/** The papers that are a reviewer's to get through: what they were given, less the ones settled without them (convex/screening/dealing.ts `waitingOf`). */
export const theirsOf = (tally: { dealt?: number; closed?: number } | undefined) => Math.max(0, (tally?.dealt ?? 0) - (tally?.closed ?? 0));

/**
 * How far a screening's models have read, as the one figure every page shows: the model furthest behind, by the papers
 * it has got through (read, or tried and couldn't) of the ones that are its to read. Null where none has a paper left.
 */
export function modelsProgress(models: Array<{ dealt: number; cast?: number; failed?: number; closed?: number }>): { done: number; of: number } | null {
  const behind = models.map((one) => ({ done: gotThrough(one), of: theirsOf(one) })).filter((one) => one.done < one.of);
  return behind.length ? behind.reduce((slow, one) => (one.done / one.of < slow.done / slow.of ? one : slow)) : null;
}

/** Someone whose account is gone still has a name where their votes are. */
export const SOMEONE = "Someone who left";
/** A model as a reviewer before it has a row: the model at one effort. The server and the pages name it the same way. */
export const modelKey = (model: string, effort?: string) => `model:${model}:${effort ?? ""}`;
/** Whether a name holds every word of what was typed, in any order and whatever their case: how a screening is found by name, in the workspace's list and in a list the page already holds. */
export const nameHas = (name: string, typed: string) => {
  const lower = name.toLocaleLowerCase();
  return typed.toLocaleLowerCase().split(/\s+/).filter(Boolean).every((word) => lower.includes(word));
};

/**
 * One model put on a screening at two efforts is two reviewers: each then says its effort, so a row, a filter or a
 * vote names the one it means. `same` is the model's own id, however the caller holds it. `named` says it in the
 * reader's language on a page (components/screening/words.ts `modelAtEffort`); the server's own words are English.
 */
export function twinsNamed<T extends { name: string; model?: { name: string; effort?: string } }>(reviewers: T[], same: (model: NonNullable<T["model"]>) => string, named: (name: string, effort: string) => string = (name, effort) => `${name}, ${effort} effort`): T[] {
  const twice = (one: T) => one.model !== undefined && reviewers.some((other) => other !== one && other.model !== undefined && same(other.model) === same(one.model!));
  return reviewers.map((one) => (one.model && twice(one) ? { ...one, name: one.model.effort ? named(one.model.name, one.model.effort) : one.model.name } : one));
}
/** Who settles conflicts once the one who did is taken off: whoever started the screening where they are still on it, else the first person still on it, else whoever started it. Conflicts always have someone to settle them. */
export const nextResolver = <Person extends string>(createdBy: Person, people: Person[]): Person => (people.includes(createdBy) ? createdBy : (people[0] ?? createdBy));

/** The most sources a screening reads at a time: the ones taken out don't count. */
export const MAX_SOURCES = 20;

/** How long a living screening waits between two checks of its sources. */
export const EVERY_MS = { day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 } as const;
