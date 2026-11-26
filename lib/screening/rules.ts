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
};

/** How long a criterion's short name can be. */
export const SHORT_NAME_LENGTH = 40;
/** The short name a criterion has until someone writes one: its question's own words, cut where they run longer than a short name can be. */
export const shortOf = (text: string) => {
  const words = text.replace(/[?.]$/, "").trim();
  return words.length > SHORT_NAME_LENGTH ? `${words.slice(0, SHORT_NAME_LENGTH - 1).trimEnd()}…` : words;
};

/** Why a paper is excluded when no criterion is the reason. */
export const OTHER_REASONS = ["duplicate", "other"] as const;

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
export type Ballot = { status: "waiting" | "cast" | "failed" | "closed" | "discarded"; decision?: Decision; at?: number; reason?: string; answers?: Record<string, Answer> };

/** Where a paper stands on its votes, under the rule. A person who settled it outranks this, and so does a result held through a change of settings. */
export function settle(rule: Rule["settle"], ballots: Ballot[]): Result {
  const cast = ballots.filter((one) => one.status === "waiting" || one.status === "cast" || one.status === "closed");
  const given = cast.filter((one): one is Ballot & { decision: Decision } => one.status === "cast" && one.decision !== undefined);
  if (!given.length) return "waiting";
  // The first vote is the earliest one cast, whoever's it is.
  if (rule === "one") return given.reduce((first, vote) => ((vote.at ?? 0) < (first.at ?? 0) ? vote : first)).decision;
  if (given.length < cast.length) return "waiting";
  const tally = DECISIONS.map((decision) => given.filter((vote) => vote.decision === decision).length);
  const top = Math.max(...tally);
  if (rule === "all") return top === given.length ? given[0]!.decision : "conflict";
  // Most of them: more than half on one side. An even split has no side.
  return top * 2 > given.length ? DECISIONS[tally.indexOf(top)]! : "conflict";
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
  return { papers, same, kappa: chance === 1 ? 1 : (same - chance) / (1 - chance) };
}

/** A number from a text, the same on every run: who gets a paper depends on the paper and the person alone. */
export const hash = (text: string) => [...text].reduce((sum, char) => (Math.imul(sum, 31) + char.charCodeAt(0)) >>> 0, 7);

/** How many people a paper goes to, of the people there are. */
export const readersFor = (each: Rule["each"], people: number) => (each === "all" ? people : Math.min(each, people));

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

/**
 * How far a screening's models have read, as the one figure every page shows: the model furthest behind, by the papers
 * it has got through (read, or tried and couldn't) of the ones that are its to read. Null where none has a paper left.
 */
export function modelsProgress(models: Array<{ dealt: number; cast?: number; failed?: number; closed?: number }>): { done: number; of: number } | null {
  const behind = models.map((one) => ({ done: (one.cast ?? 0) + (one.failed ?? 0), of: Math.max(0, one.dealt - (one.closed ?? 0)) })).filter((one) => one.done < one.of);
  return behind.length ? behind.reduce((slow, one) => (one.done / one.of < slow.done / slow.of ? one : slow)) : null;
}

/** Someone whose account is gone still has a name where their votes are. */
export const SOMEONE = "Someone who left";
/** A model as a reviewer before it has a row: the model at one effort. The server and the pages name it the same way. */
export const modelKey = (model: string, effort?: string) => `model:${model}:${effort ?? ""}`;
/** Who settles conflicts once the one who did is taken off: whoever started the screening where they are still on it, else the first person still on it, else whoever started it. Conflicts always have someone to settle them. */
export const nextResolver = <Person extends string>(createdBy: Person, people: Person[]): Person => (people.includes(createdBy) ? createdBy : (people[0] ?? createdBy));

/** The most sources a screening reads at a time: the ones taken out don't count. */
export const MAX_SOURCES = 20;

/** How long a living screening waits between two checks of its sources. */
export const EVERY_MS = { day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 } as const;
