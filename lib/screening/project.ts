// Where one paper stands and who is on it, worked out from its places and the screening's settings,
// with nothing of Convex in it. The bookkeeping worker applies what this says to the rows
// (convex/screening/settling.ts), and the preview of a change runs it on the settings as they would
// be (convex/screening/effects.ts): what a change is said to do and what it then does are one sum.

import { decide, fillPlaces, isFinal, readersFor, settle, takesOver, type Answer, type Ballot, type Criterion, type Decision, type Result, type Rule } from "./rules";

/** A reviewer's place on a paper. `reviewer` is whatever names them wherever this runs: a row's ID, or a name for someone not on the screening yet. */
export type Place = { reviewer: string; kind: "person" | "model"; status: Ballot["status"]; decision?: Decision; reason?: string; at?: number; answers?: Record<string, Answer> };

/** Who papers go to: the people they are dealt to, in the order they joined, and the models that read. `invited`: people asked by email who haven't answered yet, whom the rule waits for as for anyone on it. */
export type Team = { people: string[]; models: string[]; invited?: number };

export type PaperState = {
  id: string;
  /** Its place in the round its people are dealt from. */
  place: number;
  result: Result;
  /** A person settled it, whatever its votes say. */
  resolved?: Decision;
  /** It keeps its result: settled before the settings last changed, and nobody has voted on it or asked for it to be checked again since. */
  held: boolean;
  /** The reviewers it was moved away from. */
  away: string[];
};

export type Projected = {
  result: Result;
  /** Its places as they stand afterwards. */
  places: Place[];
  /** Places given, and places taken away because their holder left or the rule asks for fewer. */
  made: Place[];
  gone: Place[];
  /** Places open again that were closed when the paper was settled, and places closed because it now is. */
  reopened: Place[];
  closed: Place[];
};

/** A place as the rule reads it. A model's decision follows its answers under the criteria as they are; a person's is the one they gave. */
export function ballotOf(place: Place, criteria: Pick<Criterion, "key" | "must">[]): Ballot & { decision?: Decision } {
  if (place.status !== "cast") return { status: place.status, kind: place.kind };
  const voted = place.kind === "model" && place.answers ? decide(place.answers, criteria) : { decision: place.decision, reason: place.reason };
  return { status: "cast", decision: voted.decision, reason: voted.reason, at: place.at, answers: place.answers, kind: place.kind };
}

/**
 * Where a paper stands under these settings, and what that does to its places. A paper that keeps its result is left
 * as it is. One a person settled stands as they settled it. Any other is settled on its votes; while it is still open
 * its places follow the people and the rule: a vote is never taken off, a place nobody voted from is kept by whoever
 * holds it while they are on the screening, the places the rule no longer asks for go, and the ones it still lacks go
 * to the people not on the paper yet. With `models`, every model that reads the screening and has no place on the
 * paper gets one. Once it is settled, the places nobody voted from are closed. A model taken off the screening reads
 * nothing more: the places it hadn't read from go, however the paper stands. With `refill`, a paper that comes back
 * with the votes it had and none of its open places is given those places before its votes are counted: the votes of
 * some of its reviewers are not the whole paper's.
 */
export function project(paper: PaperState, places: Place[], team: Team, rule: Pick<Rule, "each" | "settle" | "models">, criteria: Pick<Criterion, "key" | "must">[], { models, refill = false }: { models: boolean; refill?: boolean }): Projected {
  // A paper isn't settled on fewer people than its rule asks for, counting whoever is invited and hasn't answered: "everyone agrees" with two people means both, and a model alone doesn't settle papers its people haven't joined to read yet. Under "first vote decides" one person is enough. A split nobody can mend stays one.
  const wanted = Math.min(rule.settle === "one" ? 1 : Infinity, readersFor(rule.each, team.people.length + (team.invited ?? 0)));
  const short = (list: Place[]) => list.filter((place) => place.kind === "person" && place.status !== "discarded").length < wanted;
  const on = (list: Place[]) => {
    const result = settle(rule.settle, list.map((place) => ballotOf(place, criteria)), rule.models);
    return (isFinal(result) || (result === "conflict" && rule.settle === "most")) && short(list) ? "waiting" : result;
  };
  const off = places.filter((place) => place.kind === "model" && place.status === "waiting" && !team.models.includes(place.reviewer));
  const stay = off.length ? places.filter((place) => !off.includes(place)) : places;
  if (paper.held) return { result: paper.result, places: stay, made: [], gone: off, reopened: [], closed: [] };
  let now: Result = paper.resolved ?? on(stay);
  let list = stay;
  const [made, gone, reopened]: Place[][] = [[], off, []];
  // Under "everyone agrees" a split can't become agreement: nobody new is given the paper, and its resolver keeps it.
  const splitForGood = now === "conflict" && rule.settle === "all";
  if (!splitForGood && (!isFinal(now) || (refill && !paper.resolved))) {
    const persons = list.filter((place) => place.kind === "person" && place.status !== "discarded");
    const open = persons.filter((place) => place.status === "waiting" || place.status === "closed");
    // A place whose holder has left the screening is free again.
    const kept = open.filter((place) => team.people.includes(place.reviewer));
    reopened.push(...kept.filter((place) => place.status === "closed"));
    // A model's place closed when a person's vote settled the paper first (below) is open again with it.
    reopened.push(...list.filter((place) => place.kind === "model" && place.status === "closed" && team.models.includes(place.reviewer)));
    // Whoever voted counts toward the rule's number, though they have since left. The places still free are for the people who haven't.
    const cast = persons.filter((place) => place.status === "cast");
    const free = Math.max(0, Math.min(team.people.length - cast.filter((place) => team.people.includes(place.reviewer)).length, readersFor(rule.each, Infinity) - cast.length));
    // More places than the rule asks for: the ones dealt last go.
    gone.push(...open.filter((place) => !team.people.includes(place.reviewer)), ...kept.slice(free));
    const holding = persons.filter((place) => !gone.includes(place)).map((place) => place.reviewer);
    made.push(...fillPlaces(team.people.map((id) => ({ id })), holding, paper.away, free - Math.min(kept.length, free), paper.place).map(({ id }) => ({ reviewer: id, kind: "person" as const, status: "waiting" as const })));
    if (models) made.push(...team.models.filter((id) => !list.some((place) => place.reviewer === id && place.status !== "discarded")).map((id) => ({ reviewer: id, kind: "model" as const, status: "waiting" as const })));
    if (made.length || gone.length || reopened.length) {
      list = [...list.filter((place) => !gone.includes(place)).map((place) => (reopened.includes(place) ? { ...place, status: "waiting" as const } : place)), ...made];
      now = on(list);
    }
  }
  // Settled: the places nobody voted from are closed, and their people's queues let go of the paper. Under "first vote decides" a model that hasn't read it yet doesn't either: its vote would count for nothing, and be paid for.
  const closed = isFinal(now) ? list.filter((place) => place.status === "waiting" && (place.kind === "person" || rule.settle === "one")) : [];
  return { result: now, places: list.map((place) => (closed.includes(place) ? { ...place, status: "closed" as const } : place)), made, gone, reopened, closed };
}

/**
 * A paper's places once people have joined the screening: on a paper that waits for votes, each of them takes over one
 * of the places nobody voted from, as often as leaves everyone an even share (`takesOver`). `joined` are the people
 * who joined, in order, each with how many people there were before them.
 */
export function withJoined(paper: Pick<PaperState, "id" | "result">, places: Place[], joined: Array<{ id: string; before: number }>, everyone: boolean): Place[] {
  if (everyone || paper.result !== "waiting") return places;
  let list = places;
  for (const person of joined) {
    if (list.some((place) => place.reviewer === person.id)) continue;
    const waiting = list.filter((place) => place.kind === "person" && place.status === "waiting");
    const at = takesOver(paper.id, person.id, person.before, waiting.length);
    if (at !== null) list = list.map((place) => (place === waiting[at] ? { ...place, reviewer: person.id } : place));
  }
  return list;
}
