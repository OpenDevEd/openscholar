// Scripted data for the screening page mock: real papers from OpenAlex (searched for
// "structured pedagogy early grade reading Africa", 2026-10-02), answers made up per paper.
import type { FilterParams } from "@/lib/filters/filter-types";
import papers from "./papers.json";

export type Paper = (typeof papers)[number];
export type Answer = "yes" | "no" | "unclear";
export type Question = { key: string; text: string; yes: number; no: number; unclear: number };
export type Outcome = "included" | "unclear" | "excluded" | "failed";

export type Source =
  /** A search keeps the screening questions set on its own panel. */
  | {
      kind: "search";
      id: string;
      label: string;
      count: number;
      /** The search's own screening questions: the ones its results page screens with. */
      questions: Question[];
      filters: FilterParams;
      /** Leading papers the results page already screened with those questions, so a job skips them. */
      screened: number;
      /** The results page the person last looked at. */
      page: number;
    }
  | { kind: "collection"; id: string; label: string; count: number }
  | { kind: "saved"; id: string; label: string; count: number }
  | { kind: "screening"; id: string; label: string; count: number };

export type Job = {
  id: string;
  name: string;
  source: Source;
  questions: Question[];
  minScore: number;
  /** The scores at which a paper gets 1 to 5 stars. */
  stars: number[];
  paperIds: string[];
  /** Papers finished so far, in the order they finished. */
  done: number;
  status: "running" | "waiting" | "completed" | "cancelled";
  model: string;
  startedAt: string;
  /** Credits held for the whole job, and spent so far. */
  hold: number;
  /** Answers someone changed by hand, by paper and question. */
  overrides: Record<string, Record<string, Answer>>;
  saveTo?: string;
  /** The source collection its papers that aren't included leave. */
  prune?: string;
};

export const PAPERS: Paper[] = papers;
const byId = new Map(PAPERS.map((p) => [p.id, p]));
/** A paper by id; a job bigger than the mock's 60 real papers repeats them as `id~n`. */
export const paperById = { get: (id: string) => byId.get(id.split("~")[0]!) };
/** Ids for `count` papers, repeating the real ones past the first 60. */
export const paperIds = (count: number) =>
  Array.from({ length: count }, (_, i) => (i < PAPERS.length ? PAPERS[i]!.id : `${PAPERS[i % PAPERS.length]!.id}~${Math.floor(i / PAPERS.length)}`));

/** Credits one paper costs on Jev, from the real estimator (4.5 a paper, rounded up per job). */
export const CREDITS_PER_PAPER = 4.5;
export const BALANCE = 2_140;
/** Papers one person may have running at once (#335): the pool's size by default. */
export const SLOTS = 20;

export const QUESTIONS: Question[] = [
  { key: "q1", text: "Is it a randomized or quasi-experimental study?", yes: 2, no: 0, unclear: 1 },
  { key: "q2", text: "Is it set in primary schools?", yes: 1, no: 0, unclear: 0 },
  { key: "q3", text: "Does it report reading outcomes?", yes: 1, no: 0, unclear: 0 },
];

/** What Generate writes for the mock's searches. */
export const GENERATED: Question[] = [
  { key: "g1", text: "Does it measure reading with a standardized assessment such as EGRA?", yes: 1, no: 0, unclear: 0 },
  { key: "g2", text: "Is it set in sub-Saharan Africa?", yes: 1, no: 0, unclear: 0 },
  { key: "g3", text: "Does the programme give teachers guides or coaching?", yes: 1, no: 0, unclear: 0 },
];

export const SOURCES: Record<Source["kind"], Source[]> = {
  search: [
    { kind: "search", id: "s1", label: "structured pedagogy early grade reading Africa", count: 61_634, questions: QUESTIONS, screened: 40, page: 2, filters: { yearRange: [2010, 2025], isYearRangeEnabled: true, filterType: "year", selectedCountryFocus: ["KE", "GH", "UG"], workTypes: ["article"], hasAbstract: true } },
    {
      kind: "search",
      id: "s2",
      label: "teacher coaching cost-effectiveness",
      count: 4_238,
      screened: 20,
      page: 1,
      filters: { openAccessOnly: true, minCitations: 10 },
      questions: [
        { key: "c1", text: "Does it report the programme's cost per pupil?", yes: 2, no: 0, unclear: 1 },
        { key: "c2", text: "Do trained coaches visit the teachers?", yes: 1, no: 0, unclear: 0 },
      ],
    },
    { kind: "search", id: "s3", label: "mother tongue instruction literacy", count: 12_907, questions: [], screened: 0, page: 1, filters: { yearRange: [2015, 2025], isYearRangeEnabled: true, filterType: "year", workLanguages: ["en", "fr"] } },
  ],
  collection: [
    { kind: "collection", id: "c1", label: "Early grade reading trials", count: 143 },
    { kind: "collection", id: "c2", label: "Coaching programmes", count: 58 },
  ],
  saved: [{ kind: "saved", id: "lib", label: "All saved papers", count: 812 }],
  screening: [{ kind: "screening", id: "j3", label: "Included in Early grade reading trials", count: 31 }],
};

/** A stable pseudo-random number in [0, 1) for a paper and a salt. */
function unit(id: string, salt: string) {
  let h = 2166136261;
  for (const c of id + salt) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

/** The model's answer to one question, and its confidence. */
export function modelAnswer(paperId: string, question: Question): { answer: Answer; confidence: number } {
  const r = unit(paperId, question.key);
  const answer: Answer = r < 0.55 ? "yes" : r < 0.82 ? "no" : "unclear";
  const confidence = answer === "unclear" ? 0.45 + unit(paperId, question.key + "c") * 0.2 : 0.7 + unit(paperId, question.key + "c") * 0.29;
  return { answer, confidence };
}

export function answerOf(job: Job, paperId: string, question: Question): { answer: Answer; confidence: number; changed: boolean } {
  const model = modelAnswer(paperId, question);
  const changed = job.overrides[paperId]?.[question.key];
  return changed ? { answer: changed, confidence: model.confidence, changed: true } : { ...model, changed: false };
}

export function scoreOf(job: Job, paperId: string) {
  return job.questions.reduce((sum, q) => sum + q[answerOf(job, paperId, q).answer], 0);
}

/** Highest score a paper can get. */
export const maxScore = (questions: Question[]) => questions.reduce((sum, q) => sum + Math.max(q.yes, q.no, q.unclear), 0);

export function outcomeOf(job: Job, paperId: string): Outcome {
  if (unit(paperId, "fail") < 0.015) return "failed";
  const answers = job.questions.map((q) => answerOf(job, paperId, q).answer);
  const score = scoreOf(job, paperId);
  if (score >= job.minScore) return "included";
  // Unclear: an unclear answer could still lift it over the minimum.
  const best = job.questions.reduce((sum, q, i) => sum + (answers[i] === "unclear" ? Math.max(q.yes, q.no, q.unclear) : q[answers[i]!]), 0);
  return best >= job.minScore ? "unclear" : "excluded";
}

/** Stars from a score: one for each star threshold it reaches, as the scoring config's star thresholds give them. */
export const starsOf = (score: number, thresholds: number[]) => thresholds.filter((t) => score >= t).length;
/** Starting star thresholds: where 1 to 5 stars begin, spread across the highest score. */
export const defaultStars = (max: number) => [1, 2, 3, 4, 5].map((k) => Math.max(1, Math.ceil((k / 5) * max)));

const ids = (from: number, count: number) => PAPERS.slice(from, from + count).map((p) => p.id);

export const START_JOBS: Job[] = [
  {
    id: "j1",
    name: "Structured pedagogy in sub-Saharan Africa",
    source: SOURCES.search[0]!,
    questions: QUESTIONS,
    minScore: 3,
    stars: [1, 2, 3, 4, 4],
    paperIds: ids(0, 60),
    done: 34,
    status: "running",
    model: "typesafe/jev-1.13",
    startedAt: "Today, 11:42",
    hold: Math.ceil(60 * CREDITS_PER_PAPER),
    overrides: {},
    saveTo: "Early grade reading trials",
  },
  {
    id: "j2",
    name: "Teacher coaching cost-effectiveness",
    source: SOURCES.search[1]!,
    questions: QUESTIONS.slice(0, 2),
    minScore: 2,
    stars: [1, 1, 2, 2, 3],
    paperIds: ids(20, 40),
    done: 0,
    status: "waiting",
    model: "typesafe/jev-1.13",
    startedAt: "Today, 11:44",
    hold: Math.ceil(40 * CREDITS_PER_PAPER),
    overrides: {},
  },
  {
    id: "j3",
    name: "Early grade reading trials",
    source: SOURCES.collection[0]!,
    questions: QUESTIONS,
    minScore: 3,
    stars: [1, 2, 3, 4, 4],
    paperIds: ids(10, 50),
    done: 50,
    status: "completed",
    model: "typesafe/jev-1.13",
    startedAt: "Yesterday, 16:05",
    hold: Math.ceil(50 * CREDITS_PER_PAPER),
    overrides: { [PAPERS[12]!.id]: { q1: "yes" } },
    prune: "Early grade reading trials",
  },
  {
    id: "j4",
    name: "Mother tongue instruction literacy",
    source: SOURCES.search[2]!,
    questions: QUESTIONS.slice(1),
    minScore: 2,
    stars: [1, 1, 2, 2, 3],
    paperIds: ids(30, 30),
    done: 12,
    status: "cancelled",
    model: "deepseek/deepseek-v3.2",
    startedAt: "Mon, 09:18",
    hold: Math.ceil(30 * CREDITS_PER_PAPER),
    overrides: {},
  },
];
