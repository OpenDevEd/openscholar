// Placeholder data for the screening mock (mock/screening-reviewers): a screening with people and
// models as reviewers, each with a vote on every paper. Everything is made up and nothing is saved.

import type { Answer } from "@/lib/screening/setup";

export type Decision = "include" | "maybe" | "exclude";
export type Stage = "abstract" | "fullText";
/** Where a paper stands: settled one way, split between its reviewers, or still short of votes. */
export type Result = Decision | "conflict" | "waiting";
export const DECISIONS: Decision[] = ["include", "maybe", "exclude"];
export const RESULTS: Result[] = ["include", "maybe", "exclude", "conflict", "waiting"];
export const DECISION_LABEL: Record<Decision, string> = { include: "Include", maybe: "Maybe", exclude: "Exclude" };
export const RESULT_LABEL: Record<Result, string> = { include: "Included", maybe: "Maybe", exclude: "Excluded", conflict: "In conflict", waiting: "Waiting for votes" };

export type Reviewer = {
  id: string;
  kind: "person" | "model";
  name: string;
  imageUrl?: string;
  /** A model's catalog slug, which picks its mark and colour. */
  modelId?: string;
  you?: boolean;
  here?: boolean;
  /** Credits a model costs for one paper. */
  credits?: number;
  /** How often it misreads a paper, for the made-up votes. */
  noise: number;
};

export const REVIEWERS: Reviewer[] = [
  { id: "amina", kind: "person", name: "Amina Otieno", imageUrl: "/mock/people/amina.jpg", you: true, here: true, noise: 0.03 },
  { id: "jonas", kind: "person", name: "Jonas Becker", imageUrl: "/mock/people/jonas.jpg", here: true, noise: 0.05 },
  { id: "thandiwe", kind: "person", name: "Thandiwe Nkosi", imageUrl: "/mock/people/thandiwe.jpg", noise: 0.04 },
  { id: "haiku", kind: "model", name: "Claude Haiku 5.5", modelId: "anthropic/claude-haiku-5.5", credits: 2, noise: 0.06 },
  { id: "gemini", kind: "model", name: "Gemini 3 Flash", modelId: "google/gemini-3-flash", credits: 1, noise: 0.1 },
  { id: "gpt", kind: "model", name: "GPT-6 mini", modelId: "openai/gpt-6-mini", credits: 3, noise: 0.13 },
];
/** People and models that can still be added to a screening. */
export const MORE_REVIEWERS: Reviewer[] = [
  { id: "rahul", kind: "person", name: "Rahul Mehta", imageUrl: "/mock/people/rahul.jpg", noise: 0.04 },
  { id: "sofia", kind: "person", name: "Sofia Marques", imageUrl: "/mock/people/sofia.jpg", noise: 0.04 },
  { id: "sonnet", kind: "model", name: "Claude Sonnet 5.5", modelId: "anthropic/claude-sonnet-5.5", credits: 9, noise: 0.04 },
  { id: "mistral", kind: "model", name: "Mistral Small 4", modelId: "mistralai/mistral-small-4", credits: 1, noise: 0.14 },
];
export const YOU = REVIEWERS[0]!;
export const PEOPLE = REVIEWERS.filter((r) => r.kind === "person");
export const MODELS = REVIEWERS.filter((r) => r.kind === "model");

export type Criterion = { key: string; text: string; short: string; must: boolean; terms: string[] };
export const CRITERIA: Criterion[] = [
  { key: "design", text: "Is the study a randomised or quasi-experimental evaluation?", short: "Experimental design", must: true, terms: ["randomised", "quasi-experimental", "trial", "control", "survey", "case study", "review"] },
  { key: "age", text: "Are the learners of primary-school age, 5 to 12?", short: "Primary age", must: true, terms: ["primary", "secondary", "grade", "aged"] },
  { key: "place", text: "Was the study carried out in sub-Saharan Africa?", short: "Sub-Saharan Africa", must: true, terms: [] },
  { key: "outcome", text: "Does it report a learning outcome measured with a test?", short: "Tested outcome", must: false, terms: ["test", "assessment", "scores", "standard deviations"] },
  { key: "digital", text: "Is the intervention delivered with digital technology?", short: "Digital delivery", must: false, terms: ["tablet", "software", "radio", "mobile", "digital", "SMS"] },
];

export type Source = { id: string; kind: "search" | "collection" | "upload" | "pdf"; name: string; detail: string; duplicates: number };
export const SOURCES: Source[] = [
  { id: "s1", kind: "search", name: "tablet OR software AND literacy AND primary school", detail: "Openscholar search", duplicates: 0 },
  { id: "s2", kind: "search", name: "EdTech numeracy sub-Saharan Africa", detail: "Openscholar search", duplicates: 6 },
  { id: "s3", kind: "upload", name: "pubmed-export-2026-11.ris", detail: "Reference file", duplicates: 5 },
  { id: "s4", kind: "pdf", name: "PDFs from the team drive", detail: "Read from the files", duplicates: 2 },
];

export type Paper = {
  id: string;
  title: string;
  authors: string[];
  year: number;
  venue: string;
  cited: number;
  /** The abstract, a sentence per criterion it speaks to, in the criteria's order. */
  sentences: string[];
  source: string;
  hasPdf: boolean;
};

export type Vote = { decision: Decision; answers: Record<string, Answer>; reason?: string; at: number };
export type Votes = Record<string, Record<string, Vote | undefined>>;

// A small seeded generator, so the same papers and votes come out on the server and in the browser.
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(rand: () => number, list: readonly T[]) => list[Math.floor(rand() * list.length)]!;

const TOPICS = [
  { title: "Tablet-based literacy instruction", means: "a tablet-based literacy programme", outcome: "reading fluency", digital: true },
  { title: "Adaptive numeracy software", means: "adaptive numeracy software", outcome: "numeracy", digital: true },
  { title: "Interactive radio lessons", means: "interactive radio instruction", outcome: "early-grade reading", digital: true },
  { title: "Structured pedagogy with teacher coaching", means: "structured lesson plans with monthly coaching", outcome: "literacy and numeracy", digital: false },
  { title: "SMS nudges to caregivers", means: "weekly SMS messages to caregivers", outcome: "attendance and reading", digital: true },
  { title: "Solar-powered digital libraries", means: "an offline digital library", outcome: "reading comprehension", digital: true },
  { title: "Teaching at the right level", means: "grouping learners by level", outcome: "foundational numeracy", digital: false },
  { title: "Mother-tongue reading materials", means: "storybooks in the home language", outcome: "oral reading fluency", digital: false },
  { title: "Mobile coaching for teachers", means: "coaching delivered by mobile phone", outcome: "classroom practice and reading", digital: true },
  { title: "Computer-assisted remedial classes", means: "computer-assisted remedial lessons", outcome: "mathematics", digital: true },
  { title: "School feeding and learning", means: "a daily school meal", outcome: "test scores and attendance", digital: false },
  { title: "Peer tutoring in large classes", means: "structured peer tutoring", outcome: "reading", digital: false },
] as const;
const PLACES = ["Kenya", "Ghana", "Tanzania", "Uganda", "Rwanda", "Malawi", "Nigeria", "Ethiopia", "Zambia", "Senegal", "India", "Peru"] as const;
const AFRICAN = (place: string) => place !== "India" && place !== "Peru";
const DESIGNS = [
  { name: "a cluster-randomised trial", answer: "yes" },
  { name: "a randomised controlled trial", answer: "yes" },
  { name: "a quasi-experimental study", answer: "yes" },
  { name: "a mixed-methods evaluation", answer: "unclear" },
  { name: "a qualitative case study", answer: "no" },
  { name: "a cross-sectional survey", answer: "no" },
  { name: "a systematic review", answer: "no" },
] as const;
const AGES = [
  { text: "learners in grades 1 to 3", answer: "yes" },
  { text: "primary pupils aged 6 to 11", answer: "yes" },
  { text: "children in upper primary", answer: "yes" },
  { text: "lower secondary students aged 13 to 16", answer: "no" },
  { text: "learners whose ages are not reported", answer: "unclear" },
] as const;
const SURNAMES = ["Mwangi", "Asante", "Okafor", "Banda", "Tembo", "Diallo", "Kamau", "Piper", "Evans", "Muralidharan", "Ochieng", "Mensah", "Habimana", "Jukes", "Abebe", "Ndlovu"];
const VENUES = ["Journal of Development Economics", "Comparative Education Review", "International Journal of Educational Development", "World Development", "Computers & Education", "Journal of Research on Educational Effectiveness"];

type Truth = Record<string, Answer>;
const truths: Record<string, Truth> = {};

export const PAPERS: Paper[] = TOPICS.flatMap((topic, t) =>
  PLACES.slice(0, 10 + (t % 3)).map((place, p) => {
    const rand = seeded(t * 97 + p * 13 + 5);
    const design = pick(rand, DESIGNS);
    const age = pick(rand, AGES);
    const tested = rand() < 0.75 ? "yes" : rand() < 0.5 ? "no" : "unclear";
    const schools = 20 + Math.floor(rand() * 180);
    const effect = (0.05 + rand() * 0.4).toFixed(2);
    const id = `p${t}-${p}`;
    truths[id] = { design: design.answer, age: age.answer, place: AFRICAN(place) ? "yes" : "no", outcome: tested, digital: topic.digital ? "yes" : "no" };
    const sourceAt = (t * 12 + p) % 20;
    return {
      id,
      title: `${topic.title} in ${place}: ${design.name}`,
      authors: [pick(rand, SURNAMES), pick(rand, SURNAMES), pick(rand, SURNAMES)].map((name, i) => `${"ABCDEFGHJKLMNPRST"[Math.floor(rand() * 17)]}. ${name}${i === 2 && rand() < 0.4 ? " and others" : ""}`),
      year: 2012 + Math.floor(rand() * 14),
      venue: pick(rand, VENUES),
      cited: Math.floor(rand() * rand() * 400),
      sentences: [
        `We report ${design.name} of ${topic.means}.`,
        `The study followed ${age.text} in ${schools} schools.`,
        `Schools were drawn from ${place === "India" ? "three states of India" : place === "Peru" ? "rural Peru" : `four districts of ${place}`}.`,
        tested === "yes" ? `After two school years, ${topic.outcome} test scores rose by ${effect} standard deviations.` : tested === "no" ? `Teachers and head teachers described changes in ${topic.outcome} in interviews.` : `Results for ${topic.outcome} are discussed.`,
        topic.digital ? `The programme was delivered with ${topic.means}, with devices kept at the school.` : `The programme used ${topic.means} and printed materials only.`,
      ],
      source: sourceAt < 11 ? "s1" : sourceAt < 16 ? "s2" : sourceAt < 19 ? "s3" : "s4",
      hasPdf: rand() > 0.12,
    };
  }),
);

/** A reviewer's decision, from their answers: a must-have criterion answered no excludes, an unclear one leaves it open. */
export function decide(answers: Record<string, Answer>): Pick<Vote, "decision" | "reason"> {
  const failed = CRITERIA.find((c) => c.must && answers[c.key] === "no");
  if (failed) return { decision: "exclude", reason: failed.key };
  return { decision: CRITERIA.some((c) => c.must && answers[c.key] === "unclear") ? "maybe" : "include" };
}

const OTHER: Record<Answer, Answer[]> = { yes: ["unclear", "no"], no: ["unclear", "yes"], unclear: ["yes", "no"] };
function voteOf(paper: Paper, reviewer: Reviewer, index: number, stage: Stage): Vote {
  const rand = seeded(index * 31 + reviewer.id.length * 7 + reviewer.id.charCodeAt(0) + (stage === "fullText" ? 1000 : 0));
  const answers = { ...truths[paper.id]! };
  // At full text there is more to go on, so fewer misreadings and fewer unclear answers.
  if (rand() < reviewer.noise * (stage === "fullText" ? 0.5 : 1)) {
    const criterion = pick(rand, CRITERIA);
    answers[criterion.key] = pick(rand, OTHER[answers[criterion.key]!]);
  }
  return { ...decide(answers), answers, at: Date.UTC(2026, 10, 20, 9) + index * 97_000 + reviewer.id.length * 3_600_000 };
}

/** The two people each paper is dealt to. */
const DEALT = [["amina", "jonas"], ["amina", "thandiwe"], ["jonas", "thandiwe"]] as const;
export const dealtTo = (index: number): readonly string[] => DEALT[index % 3]!;
/** How far each reviewer has got through their papers. */
const REACHED: Record<string, number> = { amina: 0.79, jonas: 1, thandiwe: 0.64, haiku: 1, gemini: 1, gpt: 0.78 };

function votesFor(stage: Stage, papers: Paper[]): Votes {
  const votes: Votes = {};
  papers.forEach((paper, index) => {
    votes[paper.id] = {};
    for (const reviewer of REVIEWERS) {
      const theirs = reviewer.kind === "model" || dealtTo(index).includes(reviewer.id);
      const reached = index < papers.length * (stage === "fullText" ? Math.min(1, REACHED[reviewer.id]! * 0.8) : REACHED[reviewer.id]!);
      votes[paper.id]![reviewer.id] = theirs && reached ? voteOf(paper, reviewer, index, stage) : undefined;
    }
  });
  return votes;
}

/** Who must vote on a paper before it can settle: every model, and the two people it was dealt to. */
export const votersOf = (index: number) => REVIEWERS.filter((r) => r.kind === "model" || dealtTo(index).includes(r.id));

export type Settled = { result: Result; final?: Decision; resolvedBy?: string };
/** Where each paper stands, from its votes: settled when all its reviewers agree, in conflict when they split. */
export function settle(papers: Paper[], votes: Votes, resolved: Record<string, Decision>): Record<string, Settled> {
  const out: Record<string, Settled> = {};
  papers.forEach((paper, index) => {
    const cast = votersOf(index).map((r) => votes[paper.id]?.[r.id]);
    if (resolved[paper.id]) out[paper.id] = { result: resolved[paper.id]!, final: resolved[paper.id], resolvedBy: YOU.id };
    else if (cast.some((vote) => !vote)) out[paper.id] = { result: "waiting" };
    else if (cast.every((vote) => vote!.decision === cast[0]!.decision)) out[paper.id] = { result: cast[0]!.decision, final: cast[0]!.decision };
    else out[paper.id] = { result: "conflict" };
  });
  return out;
}

const abstractVotes = votesFor("abstract", PAPERS);
/** Conflicts already settled by a person before the mock opens: every other one. */
const abstractResolved: Record<string, Decision> = {};
{
  let n = 0;
  PAPERS.forEach((paper, index) => {
    const cast = votersOf(index).map((r) => abstractVotes[paper.id]?.[r.id]);
    if (cast.some((vote) => !vote) || cast.every((vote) => vote!.decision === cast[0]!.decision)) return;
    if (n++ % 2 === 0) {
      const counts = DECISIONS.map((d) => cast.filter((vote) => vote!.decision === d).length);
      abstractResolved[paper.id] = DECISIONS[counts.indexOf(Math.max(...counts))]!;
    }
  });
}
const abstractSettled = settle(PAPERS, abstractVotes, abstractResolved);
/** Papers included on their abstract go on to full text. */
const FULL_TEXT_PAPERS = PAPERS.filter((paper) => abstractSettled[paper.id]!.final === "include");

export const STAGES: Record<Stage, { label: string; papers: Paper[]; votes: Votes; resolved: Record<string, Decision> }> = {
  abstract: { label: "Title and abstract", papers: PAPERS, votes: abstractVotes, resolved: abstractResolved },
  fullText: { label: "Full text", papers: FULL_TEXT_PAPERS, votes: votesFor("fullText", FULL_TEXT_PAPERS), resolved: {} },
};

/** The passage a model quotes for its answer to a criterion, and why. */
export function evidence(paper: Paper, criterion: Criterion, answer: Answer) {
  const quote = paper.sentences[CRITERIA.indexOf(criterion)]!;
  const why = answer === "yes" ? "The text states this." : answer === "no" ? "The text says otherwise." : "The text doesn't settle this.";
  return { quote, why };
}

/** Cohen's kappa between two reviewers over the papers both voted on, with how many those were. */
export function agreement(a: string, b: string, papers: Paper[], votes: Votes) {
  const both = papers.flatMap((paper) => {
    const [x, y] = [votes[paper.id]?.[a], votes[paper.id]?.[b]];
    return x && y ? [[x.decision, y.decision] as const] : [];
  });
  if (!both.length) return null;
  const same = both.filter(([x, y]) => x === y).length / both.length;
  const chance = DECISIONS.reduce((sum, d) => sum + (both.filter(([x]) => x === d).length / both.length) * (both.filter(([, y]) => y === d).length / both.length), 0);
  return { papers: both.length, same, kappa: chance === 1 ? 1 : (same - chance) / (1 - chance) };
}

export type ScreeningRow = { id: string; name: string; sources: number; papers: number; reviewers: string[]; counts: Record<Result, number>; forYou: number; conflicts: number; finished?: boolean; updated: string };
/** The workspace's screenings, as the list shows them. The first is the one the mock opens. */
export const SCREENINGS: ScreeningRow[] = [
  { id: "edtech", name: "EdTech and foundational learning", sources: 4, papers: PAPERS.length, reviewers: REVIEWERS.map((r) => r.id), counts: { include: 0, maybe: 0, exclude: 0, conflict: 0, waiting: 0 }, forYou: 0, conflicts: 0, updated: "2 minutes ago" },
  { id: "tvet", name: "TVET and youth employment", sources: 2, papers: 1840, reviewers: ["amina", "thandiwe", "haiku", "gemini"], counts: { include: 212, maybe: 31, exclude: 1404, conflict: 22, waiting: 171 }, forYou: 64, conflicts: 22, updated: "yesterday" },
  { id: "girls", name: "Girls' secondary schooling, cash transfers", sources: 3, papers: 612, reviewers: ["jonas", "amina", "haiku"], counts: { include: 58, maybe: 12, exclude: 371, conflict: 0, waiting: 171 }, forYou: 0, conflicts: 0, updated: "3 days ago" },
  { id: "teachers", name: "Teacher professional development", sources: 1, papers: 2400, reviewers: ["haiku", "gemini", "gpt"], counts: { include: 301, maybe: 96, exclude: 1911, conflict: 92, waiting: 0 }, forYou: 0, conflicts: 92, updated: "last week" },
  { id: "climate", name: "Climate adaptation in schools", sources: 2, papers: 438, reviewers: ["amina", "jonas"], counts: { include: 71, maybe: 0, exclude: 367, conflict: 0, waiting: 0 }, forYou: 0, conflicts: 0, finished: true, updated: "12 Nov" },
  { id: "ecd", name: "Early childhood development, home visits", sources: 2, papers: 1022, reviewers: ["thandiwe", "amina", "haiku", "gpt"], counts: { include: 143, maybe: 0, exclude: 879, conflict: 0, waiting: 0 }, forYou: 0, conflicts: 0, finished: true, updated: "2 Nov" },
  { id: "nutrition", name: "School nutrition and attendance", sources: 1, papers: 187, reviewers: ["jonas"], counts: { include: 22, maybe: 0, exclude: 165, conflict: 0, waiting: 0 }, forYou: 0, conflicts: 0, finished: true, updated: "28 Oct" },
];

export const reviewerOf = (id: string) => [...REVIEWERS, ...MORE_REVIEWERS].find((r) => r.id === id)!;
export const count = <T,>(list: T[], test: (item: T) => boolean) => list.reduce((n, item) => n + (test(item) ? 1 : 0), 0);
