// Placeholder data for the screening mock (mock/screening-reviewers). A screening holds its sources,
// criteria, reviewers and rule, and every one of them can change at any time: papers, votes and
// results are worked out from them on each read, so a change shows everywhere at once.
// Everything here is made up and nothing is saved.

import type { MapModel } from "@/components/settings/model-map";
import type { Answer } from "@/lib/screening/setup";

export type Decision = "include" | "maybe" | "exclude";
export type Stage = "abstract" | "fullText";
/** Where a paper stands: settled one way, split between its reviewers, or still short of votes. */
export type Result = Decision | "conflict" | "waiting";
export const DECISIONS: Decision[] = ["include", "maybe", "exclude"];
export const RESULTS: Result[] = ["include", "maybe", "exclude", "conflict", "waiting"];
export const STAGES: Stage[] = ["abstract", "fullText"];
export const STAGE_LABEL: Record<Stage, string> = { abstract: "Title and abstract", fullText: "Full text" };
export const DECISION_LABEL: Record<Decision, string> = { include: "Include", maybe: "Maybe", exclude: "Exclude" };
export const RESULT_LABEL: Record<Result, string> = { include: "Included", maybe: "Maybe", exclude: "Excluded", conflict: "In conflict", waiting: "Waiting for votes" };

// ── People and models ────────────────────────────────────────────────────────────────────────────

export type Person = { id: string; name: string; imageUrl: string; guest?: boolean; here?: boolean; seen: string };
const face = (id: string) => `/mock/people/${id}.jpg`;
/** The workspace's members, then people from outside it. The first is who the mock starts as. */
export const PEOPLE: Person[] = [
  { id: "amina", name: "Amina Otieno", imageUrl: face("amina"), here: true, seen: "Here now" },
  { id: "jonas", name: "Jonas Becker", imageUrl: face("jonas"), here: true, seen: "Here now" },
  { id: "thandiwe", name: "Thandiwe Nkosi", imageUrl: face("thandiwe"), seen: "Here yesterday" },
  { id: "kwame", name: "Kwame Mensah", imageUrl: face("kwame"), seen: "Here 3 days ago" },
  { id: "leila", name: "Leila Haddad", imageUrl: face("leila"), seen: "Here last week" },
  { id: "daniel", name: "Daniel Okoro", imageUrl: face("daniel"), seen: "Here 2 weeks ago" },
  { id: "grace", name: "Grace Wanjiru", imageUrl: face("grace"), seen: "Not here yet" },
  { id: "rahul", name: "Rahul Mehta", imageUrl: face("rahul"), guest: true, seen: "Here on Monday" },
  { id: "sofia", name: "Sofia Marques", imageUrl: face("sofia"), guest: true, seen: "Here last week" },
  { id: "mei", name: "Mei Tanaka", imageUrl: face("mei"), guest: true, seen: "Not here yet" },
  { id: "tomas", name: "Tomás Rivera", imageUrl: face("tomas"), guest: true, seen: "Not here yet" },
];
export const personOf = (id: string) => PEOPLE.find((person) => person.id === id);

/** Workspaces a screening can be in. The first is the one the mock is in; the others are where it can move to, or be shared from. */
export type Workspace = { id: string; kind: "organization" | "personal"; name: string; colour?: string; imageUrl?: string; members: string; credits: number; /** Whether the person the mock starts as is a member: a screening moves only between those. */ mine: boolean };
export const WORKSPACES: Workspace[] = [
  { id: "hub", kind: "organization", name: "EdTech Hub", colour: "#0d9488", members: "7 members", credits: 18_420, mine: true },
  { id: "network", kind: "organization", name: "Open Learning Network", colour: "#db2777", members: "23 members", credits: 41_800, mine: true },
  { id: "own", kind: "personal", name: "Your own workspace", imageUrl: face("amina"), members: "Only you", credits: 2_300, mine: true },
  { id: "lab", kind: "organization", name: "Learning Evidence Lab", colour: "#6366f1", members: "12 members", credits: 64_000, mine: false },
];
export const HOME = WORKSPACES[0]!;
export const workspaceOf = (screening: Pick<Screening, "workspace">) => WORKSPACES.find((one) => one.id === screening.workspace) ?? HOME;

/**
 * Someone or something that votes: a person, a person invited by email who has no account yet,
 * or a model at one reasoning effort. A reviewer taken off a screening keeps their votes on record
 * (`left`), and they stop counting.
 */
export type Reviewer = {
  id: string;
  kind: "person" | "model";
  name: string;
  imageUrl?: string;
  email?: string;
  model?: MapModel;
  addedAt: number;
  left?: number;
  /** When the person was last sent a reminder. */
  reminded?: number;
};
export const personReviewer = (person: Person, addedAt: number): Reviewer => ({ id: person.id, kind: "person", name: person.name, imageUrl: person.imageUrl, addedAt });
export const invitedReviewer = (email: string, addedAt: number): Reviewer => ({ id: `invite:${email}`, kind: "person", name: email, email, addedAt });
export const modelReviewer = (model: MapModel, addedAt: number): Reviewer => ({ id: `model:${model.id}:${model.effort ?? ""}`, kind: "model", name: model.name, model, addedAt });

/**
 * The models a made-up screening runs, as the catalogue has them on 23 November 2026, so the page is
 * drawn with their names, marks and prices from its first frame. The catalogue's own rows take their
 * place once it is read (./store.tsx), which changes nothing on screen while these still match.
 */
export const SEED_MODELS: MapModel[] = [
  { id: "typesafe/jev-1.13", name: "Jev 1.13", inputPricePerMillion: 0.041999999999999996, outputPricePerMillion: 0 },
  { id: "anthropic/claude-haiku-5.5", name: "Claude Haiku 5.5", inputPricePerMillion: 0.09999999999999999, outputPricePerMillion: 0.5 },
  { id: "google/gemma-3-4b-it", name: "Gemma 3 4B", inputPricePerMillion: 0.04, outputPricePerMillion: 0.049999999999999996 },
];

// ── Criteria, sources and the rule ───────────────────────────────────────────────────────────────

export type Criterion = { key: string; text: string; short: string; must: boolean; terms: string[]; addedAt: number };
export const DEFAULT_CRITERIA: Criterion[] = [
  { key: "design", text: "Is the study a randomised or quasi-experimental evaluation?", short: "Experimental design", must: true, terms: ["randomised", "quasi-experimental", "trial", "control", "survey", "case study", "review"], addedAt: 0 },
  { key: "age", text: "Are the learners of primary-school age, 5 to 12?", short: "Primary age", must: true, terms: ["primary", "secondary", "grades", "aged"], addedAt: 0 },
  { key: "place", text: "Was the study carried out in sub-Saharan Africa?", short: "Sub-Saharan Africa", must: true, terms: [], addedAt: 0 },
  { key: "outcome", text: "Does it report a learning outcome measured with a test?", short: "Tested outcome", must: false, terms: ["test", "assessment", "scores", "standard deviations"], addedAt: 0 },
  { key: "digital", text: "Is the intervention delivered with digital technology?", short: "Digital delivery", must: false, terms: ["tablet", "software", "radio", "mobile", "digital", "SMS"], addedAt: 0 },
];
/** A short name for a criterion written by hand: its words without the question around them. */
export const shortOf = (text: string) => {
  const words = text.replace(/[?.]$/, "").replace(/^(is|are|was|were|does|do|did|has|have) (the |it |they |there )?/i, "").trim();
  const cut = words.length > 28 ? `${words.slice(0, 26).trimEnd()}…` : words;
  return cut.charAt(0).toUpperCase() + cut.slice(1);
};

export type SourceKind = "search" | "collection" | "saved" | "screening" | "evidenceLibrary" | "zotero" | "upload" | "pdf" | "dois";
/** Papers from one place. `total` is what it holds, `range` the ones taken, `duplicates` how many of those another source already brought. */
export type Source = { id: string; /** Which run of made-up papers it holds: never reused, so a paper keeps its identity when sources change. */ slot: number; kind: SourceKind; name: string; detail: string; total: number; scope: "all" | "range"; range: [number, number]; duplicates: number; facts?: string[]; /** A search's filters, which tell two searches for the same words apart. */ filters?: string[]; addedAt: number };
export const taken = (source: Source) => (source.scope === "all" ? source.total : Math.max(0, source.range[1] - source.range[0] + 1));
export const keptOf = (source: Source) => Math.max(0, taken(source) - Math.min(source.duplicates, taken(source)));
export const paperTotal = (sources: Source[]) => sources.reduce((sum, source) => sum + keptOf(source), 0);

export type Rule = {
  /** How many people read each paper. */
  each: "1" | "2" | "all";
  /** When a paper is settled: every reviewer agrees, most of them do, or the first vote decides. */
  settle: "all" | "most" | "one";
  /** Who settles a split. */
  resolver: string;
  /** When people see the other votes on a paper. */
  blind: "after" | "always";
};
export type Scoring = { points: Record<string, [number, number, number]>; minimum: number; stars: number[] };
export type Destination = { kind: "none" | "new" | "collection" | "community"; name: string; collection?: string; prune: boolean };

/** Why a paper is excluded when it isn't one of the criteria: shown after them in the list of reasons. */
export const OTHER_REASONS: Record<Stage, Array<{ key: string; label: string }>> = {
  abstract: [{ key: "duplicate", label: "A duplicate of another paper" }, { key: "other", label: "Another reason, in the note" }],
  fullText: [{ key: "not-retrieved", label: "Full text not retrieved" }, { key: "type", label: "Not a full study (a protocol, an abstract, a comment)" }, { key: "duplicate", label: "A duplicate of another paper" }, { key: "other", label: "Another reason, in the note" }],
};
/** A reason in words: the criterion's short name, or one of the others. */
export const reasonLabel = (key: string, criteria: Criterion[]) => criteria.find((criterion) => criterion.key === key)?.short ?? [...OTHER_REASONS.abstract, ...OTHER_REASONS.fullText].find((one) => one.key === key)?.label ?? key;
/** The one reason an excluded paper is counted under: the one most of its reviewers gave. */
export function reasonOf(cast: Array<{ vote: Vote | undefined }>, settled?: Settled): string | undefined {
  if (settled?.reason) return settled.reason;
  const given = cast.flatMap((one) => (one.vote?.decision === "exclude" && one.vote.reason ? [one.vote.reason] : []));
  return [...new Set(given)].sort((a, b) => given.filter((r) => r === b).length - given.filter((r) => r === a).length)[0];
}

// ── A screening ──────────────────────────────────────────────────────────────────────────────────

export type Vote = { decision: Decision; answers: Record<string, Answer>; reason?: string; note?: string; at: number };
export type Settled = { result: Result; final?: Decision; resolvedBy?: string; note?: string; reason?: string };
export type Change = { at: number; by: string; what: string; effect?: string };

export type Screening = {
  id: string;
  name: string;
  createdBy: string;
  createdAt: number;
  finishedAt?: number;
  /** The models are held where they are until someone lets them go on. */
  paused?: boolean;
  /** What the review asks, which criteria are written from. */
  question: string;
  /** Whether papers kept on their abstract are screened again on their full text. */
  fullText: boolean;
  sources: Source[];
  criteria: Criterion[];
  reviewers: Reviewer[];
  rule: Rule;
  scoring: Scoring;
  destination: Destination;
  /** Which made-up papers it gets. */
  seed: number;
  /** How many of its papers each reviewer has got through, at each stage. */
  reached: Record<Stage, Record<string, number>>;
  /** The votes cast in the mock, by whoever the mock is seen as, over the made-up ones. Null takes a vote back. */
  cast: Record<Stage, Record<string, Record<string, Vote | null>>>;
  /** Splits settled by a person. Null reopens one. */
  resolved: Record<Stage, Record<string, { decision: Decision; by: string; note?: string; reason?: string } | null>>;
  /** Full texts added by hand, and papers marked as not retrieved, by paper. */
  fullTexts: Record<string, "added" | "missing">;
  changes: Change[];
  /** People it is shared with who see everything and don't vote. */
  viewers?: Reviewer[];
  /** The workspace it is in, where that isn't the one the mock is in. */
  workspace?: string;
  /** Models that were sent back to the papers they couldn't read. */
  retried?: string[];
  /** How many of its papers have arrived, while they are still being fetched from its sources. */
  gathered?: number;
  /** The screening whose models read first: a workspace's models read so many papers at once. */
  after?: string;
};

/**
 * What someone is to a screening. A member of its workspace sees it and can change it, and votes
 * where they are a reviewer. Someone from outside sees it only once it is shared with them, to vote
 * or to look, and never changes its settings.
 */
export function accessOf(screening: Screening, viewer: string): { reviewer: boolean; member: boolean } | null {
  const reviewer = activeReviewers(screening).some((one) => one.id === viewer);
  const workspace = workspaceOf(screening);
  const member = !personOf(viewer)?.guest && (workspace === HOME || (workspace.mine && viewer === PEOPLE[0]!.id));
  return reviewer || member || screening.viewers?.some((one) => one.id === viewer) ? { reviewer, member } : null;
}

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
const hash = (text: string) => [...text].reduce((sum, char) => (Math.imul(sum, 31) + char.charCodeAt(0)) >>> 0, 7);

// ── Papers ───────────────────────────────────────────────────────────────────────────────────────

export type Paper = {
  id: string;
  title: string;
  authors: string[];
  year: number;
  venue: string;
  cited: number;
  /** The abstract, a sentence for each of the first criteria it speaks to, in their order. None for a paper that came without one. */
  sentences: string[];
  /** The abstract in its own language, for a paper not written in English. */
  original?: { language: string; text: string };
  source: string;
  hasPdf: boolean;
  truth: Record<string, Answer>;
};

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

function paperAt(seed: number, slot: number, i: number): Omit<Paper, "source"> {
  const n = slot * 337 + i;
  const rand = seeded(seed * 7919 + n * 104729 + 11);
  // Topic, place and design cycle at different lengths, so titles don't repeat for the first 1,008 papers.
  const topic = TOPICS[n % TOPICS.length]!;
  const place = PLACES[(Math.floor(n / TOPICS.length) + n) % PLACES.length]!;
  const design = DESIGNS[(Math.floor(n / (TOPICS.length * PLACES.length)) + n * 3) % DESIGNS.length]!;
  const age = pick(rand, AGES);
  const tested: Answer = rand() < 0.75 ? "yes" : rand() < 0.5 ? "no" : "unclear";
  const schools = 20 + Math.floor(rand() * 180);
  const effect = (0.05 + rand() * 0.4).toFixed(2);
  const african = place !== "India" && place !== "Peru";
  const authors = [pick(rand, SURNAMES), pick(rand, SURNAMES), pick(rand, SURNAMES)].map((name) => `${"ABCDEFGHJKLMNPRST"[Math.floor(rand() * 17)]}. ${name}`);
  const where = place === "India" ? "three states of India" : place === "Peru" ? "rural Peru" : `${pick(rand, ["four districts", "two regions", "the capital and three rural districts", "six counties"])} of ${place}`;
  const sentences = [
    pick(rand, [`We report ${design.name} of ${topic.means}.`, `This paper presents ${design.name} that looks at ${topic.means}.`, `Evidence on ${topic.means} is thin. We add ${design.name}.`]),
    pick(rand, [`The study followed ${age.text} in ${schools} schools.`, `Data come from ${schools} schools and cover ${age.text}.`, `In all, ${schools} schools took part, with ${age.text}.`]),
    pick(rand, [`Schools were drawn from ${where}.`, `Fieldwork took place in ${where}.`, `The sample covers ${where}.`]),
    tested === "yes" ? `After two school years, ${topic.outcome} test scores rose by ${effect} standard deviations.` : tested === "no" ? `Teachers and head teachers described changes in ${topic.outcome} in interviews.` : `Results for ${topic.outcome} are discussed.`,
    topic.digital ? `The programme was delivered with ${topic.means}, with devices kept at the school.` : `The programme used ${topic.means} and printed materials only.`,
  ];
  // A few papers arrive without an abstract, and a few in French: both are states a reviewer meets.
  const bare = n % 23 === 17;
  const french = !bare && n % 19 === 7;
  return {
    id: `p${seed}-${slot}-${i}`,
    title: pick(rand, [`${topic.title} in ${place}: ${design.name}`, `${topic.title} and ${topic.outcome}: evidence from ${place}`, `Does ${topic.means} improve ${topic.outcome}? ${design.name.charAt(0).toUpperCase()}${design.name.slice(1)} in ${place}`, `${topic.outcome.charAt(0).toUpperCase()}${topic.outcome.slice(1)} after ${topic.means} in ${place}`]),
    authors: rand() < 0.35 ? [...authors, "and others"] : authors,
    year: 2012 + Math.floor(rand() * 14),
    venue: pick(rand, VENUES),
    cited: Math.floor(rand() * rand() * 400),
    sentences: bare ? [] : sentences,
    ...(french ? { original: { language: "French", text: `Nous présentons ${design.name === "a systematic review" ? "une revue systématique" : "une évaluation"} portant sur ${schools} écoles (${place}). L'étude a suivi des élèves du primaire pendant deux années scolaires et mesure les acquis en lecture et en calcul.` } } : {}),
    hasPdf: rand() > 0.14,
    truth: { design: design.answer, age: age.answer, place: african ? "yes" : "no", outcome: tested, digital: topic.digital ? "yes" : "no" },
  };
}

const papersCache = new Map<string, Paper[]>();
/** A screening's papers: as many as its sources bring, each from the source whose turn it is. */
export function papersOf(screening: Pick<Screening, "seed" | "sources">): Paper[] {
  const key = `${screening.seed}:${screening.sources.map((source) => `${source.slot}=${source.scope === "all" ? 1 : source.range[0]}+${keptOf(source)}`).join(",")}`;
  const kept = papersCache.get(key);
  if (kept) return kept;
  const papers: Paper[] = [];
  for (const source of screening.sources) {
    const first = source.scope === "all" ? 0 : source.range[0] - 1;
    for (let i = 0; i < keptOf(source); i++) papers.push({ ...paperAt(screening.seed, source.slot, first + i), source: source.id });
  }
  // Sources take turns down the list, as merged search results do, without changing which paper is which.
  const mixed = papers.map((paper, index) => ({ paper, order: hash(paper.id) % 997, index })).sort((a, b) => a.order - b.order || a.index - b.index).map((one) => one.paper);
  papersCache.set(key, mixed);
  return mixed;
}
/** The papers that have arrived so far: all of them, once they are fetched. */
const arrived = (screening: Pick<Screening, "seed" | "sources" | "gathered">) => (screening.gathered === undefined ? papersOf(screening) : papersOf(screening).slice(0, screening.gathered));

// ── Votes ────────────────────────────────────────────────────────────────────────────────────────

/** What a paper really is for a criterion: known for the first five, drawn from the paper for one added by hand. */
export const truthOf = (paper: Paper, criterion: Criterion): Answer => paper.truth[criterion.key] ?? (["yes", "yes", "yes", "no", "unclear"] as const)[hash(paper.id + criterion.key) % 5]!;

/** A reviewer's decision, from their answers: a must-have criterion answered no excludes, an unclear one leaves it open. */
export function decide(answers: Record<string, Answer>, criteria: Criterion[]): Pick<Vote, "decision" | "reason"> {
  const failed = criteria.find((c) => c.must && answers[c.key] === "no");
  if (failed) return { decision: "exclude", reason: failed.key };
  return { decision: criteria.some((c) => c.must && answers[c.key] === "unclear") ? "maybe" : "include" };
}

const OTHER: Record<Answer, Answer[]> = { yes: ["unclear", "no"], no: ["unclear", "yes"], unclear: ["yes", "no"] };
/** How often a reviewer misreads a paper: people rarely, each model at its own rate. */
const noiseOf = (reviewer: Reviewer) => (reviewer.kind === "person" ? 0.03 + (hash(reviewer.id) % 3) / 100 : 0.05 + (hash(reviewer.id) % 9) / 100);

function madeUpVote(paper: Paper, reviewer: Reviewer, criteria: Criterion[], stage: Stage): Vote {
  const rand = seeded(hash(paper.id) + hash(reviewer.id) * 3 + (stage === "fullText" ? 1000 : 0));
  const answers = Object.fromEntries(criteria.map((criterion) => [criterion.key, truthOf(paper, criterion)]));
  // The full text settles what the abstract left open, and shows some papers kept on their abstract not to belong after all.
  if (stage === "fullText") {
    const musts = criteria.filter((criterion) => criterion.must);
    for (const criterion of musts) if (answers[criterion.key] === "unclear") answers[criterion.key] = hash(paper.id + criterion.key) % 2 ? "yes" : "no";
    if (musts.length && hash(paper.id) % 10 < 3) answers[musts[hash(paper.id) % musts.length]!.key] = "no";
  }
  // With no abstract there is little to go on: a model can't tell, and says so.
  if (!paper.sentences.length && stage === "abstract" && reviewer.kind === "model") for (const criterion of criteria.slice(0, 2)) answers[criterion.key] = "unclear";
  // At full text there is more to go on, so fewer misreadings.
  else if (criteria.length && rand() < noiseOf(reviewer) * (stage === "fullText" ? 0.5 : 1)) {
    const criterion = pick(rand, criteria);
    answers[criterion.key] = pick(rand, OTHER[answers[criterion.key]!]);
  }
  return { ...decide(answers, criteria), answers, at: Date.UTC(2026, 10, 20, 9) + (hash(paper.id) % 5000) * 60_000 };
}

/** Whether a paper's full text is to hand: found with it, added by hand, or marked as not retrieved. */
export const hasFullText = (screening: Pick<Screening, "fullTexts">, paper: Paper) => (screening.fullTexts[paper.id] ? screening.fullTexts[paper.id] === "added" : paper.hasPdf);

export const activeReviewers = (screening: Screening) => screening.reviewers.filter((reviewer) => !reviewer.left);
export const peopleOf = (screening: Screening) => activeReviewers(screening).filter((reviewer) => reviewer.kind === "person");
export const modelsOf = (screening: Screening) => activeReviewers(screening).filter((reviewer) => reviewer.kind === "model");

/** Whether a person has voted on a paper: in the mock, or in the made-up votes they came with. */
const hasVoted = (screening: Screening, stage: Stage, paper: Paper, index: number, person: Reviewer) => {
  const cast = screening.cast[stage][paper.id]?.[person.id];
  return cast !== undefined ? cast !== null : !person.email && index < (screening.reached[stage][person.id] ?? 0);
};
/**
 * The people a paper is dealt to: as many as the rule asks for, taken in turn so the work is shared
 * evenly. Someone added after the start takes a share of the papers nobody has got to yet, and never
 * a paper someone has already voted on.
 */
export function dealtTo(screening: Screening, stage: Stage, paper: Paper, index: number): Reviewer[] {
  // Someone invited by email is dealt papers once they have joined.
  const people = peopleOf(screening).filter((person) => !person.email);
  if (screening.rule.each === "all") return people;
  const founders = people.filter((person) => person.addedAt <= screening.createdAt);
  const base = founders.length ? founders : people;
  const late = base === people ? [] : people.filter((person) => !base.includes(person));
  const each = Math.min(Number(screening.rule.each), people.length);
  const dealt = Array.from({ length: Math.min(each, base.length) }, (_, k) => base[(index + k) % base.length]!).map((person, k) => {
    if (!late.length || hasVoted(screening, stage, paper, index, person)) return person;
    return [person, ...late][(index + k) % (late.length + 1)]!;
  });
  // Fewer founders than the rule asks for: the later people make up the number.
  for (let k = 0; dealt.length < each && k < late.length; k++) if (!dealt.includes(late[(index + k) % late.length]!)) dealt.push(late[(index + k) % late.length]!);
  return [...new Set(dealt)];
}
/** Who votes on a paper: every model, and the people it is dealt to. */
export const votersOf = (screening: Screening, stage: Stage, paper: Paper, index: number) => [...dealtTo(screening, stage, paper, index), ...modelsOf(screening)];

/** One reviewer's vote on a paper, if they have got to it: the one cast in the mock, or a made-up one. */
export function voteOf(screening: Screening, stage: Stage, paper: Paper, index: number, reviewer: Reviewer): Vote | undefined {
  const cast = screening.cast[stage][paper.id]?.[reviewer.id];
  if (cast !== undefined) return cast ?? undefined;
  if (reviewer.email || index >= (screening.reached[stage][reviewer.id] ?? 0)) return undefined;
  // Nobody can have read a full text that isn't there.
  if (stage === "fullText" && !hasFullText(screening, paper)) return undefined;
  return madeUpVote(paper, reviewer, screening.criteria, stage);
}

/**
 * A paper a model got to and couldn't read: its provider gave an error, or sent back nothing usable.
 * It counts as no vote from that model, and the paper is settled by its other reviewers.
 */
export const failedRead = (screening: Screening, stage: Stage, paper: Paper, index: number, reviewer: Reviewer) =>
  reviewer.kind === "model" && !screening.retried?.includes(reviewer.id) && index < (screening.reached[stage][reviewer.id] ?? 0) && screening.cast[stage][paper.id]?.[reviewer.id] === undefined && hash(`${paper.id}${reviewer.id}${stage}`) % 113 === 0;

/** How sure a model is of one answer, from 0 to 1: less with no abstract to read, and where it couldn't tell. */
export const confidenceOf = (paper: Paper, reviewer: Reviewer, criterion: Criterion, answer: Answer) => {
  const base = !paper.sentences.length ? 0.38 : answer === "unclear" ? 0.52 : 0.8;
  return Math.min(0.99, base + (hash(`${paper.id}${reviewer.id}${criterion.key}`) % 19) / 100);
};

/** A paper's points and stars, from the answer most of its reviewers gave to each criterion. */
export function scoreOf(screening: Pick<Screening, "criteria" | "scoring">, cast: Array<{ vote: Vote | undefined }>) {
  const points = screening.criteria.reduce((sum, criterion) => {
    const given = cast.flatMap((one) => one.vote?.answers[criterion.key] ?? []);
    if (!given.length) return sum;
    const top = (["yes", "no", "unclear"] as const).map((answer) => given.filter((one) => one === answer).length);
    return sum + (screening.scoring.points[criterion.key]?.[top.indexOf(Math.max(...top))] ?? 0);
  }, 0);
  return { points, of: screening.criteria.reduce((sum, criterion) => sum + Math.max(...(screening.scoring.points[criterion.key] ?? [0])), 0), stars: screening.scoring.stars.filter((from) => points >= from).length };
}

// ── Where each paper stands ──────────────────────────────────────────────────────────────────────

export type Standing = {
  papers: Paper[];
  /** Each paper's voters and their votes, in the voters' order. */
  votes: Record<string, Array<{ reviewer: Reviewer; vote: Vote | undefined; failed?: boolean }>>;
  settled: Record<string, Settled>;
  counts: Record<Result, number>;
};

/** The papers of a stage: all of them on their abstract, and at full text the ones included there. */
export function standing(screening: Screening, stage: Stage): Standing {
  const all = arrived(screening);
  const first = stage === "abstract" ? null : standing(screening, "abstract");
  const papers = first ? (screening.fullText ? all.filter((paper) => first.settled[paper.id]?.final === "include" || first.settled[paper.id]?.final === "maybe") : []) : all;
  const votes: Standing["votes"] = {};
  const settled: Standing["settled"] = {};
  const counts: Record<Result, number> = { include: 0, maybe: 0, exclude: 0, conflict: 0, waiting: 0 };
  papers.forEach((paper, index) => {
    const everyone = votersOf(screening, stage, paper, index).map((reviewer) => (failedRead(screening, stage, paper, index, reviewer) ? { reviewer, vote: undefined, failed: true } : { reviewer, vote: voteOf(screening, stage, paper, index, reviewer) }));
    votes[paper.id] = everyone;
    // A model that couldn't read the paper has no say in it.
    const cast = everyone.filter((one) => !("failed" in one));
    const resolved = screening.resolved[stage][paper.id];
    const given = cast.flatMap((one) => one.vote ?? []);
    const tally = DECISIONS.map((decision) => given.filter((vote) => vote.decision === decision).length);
    const top = Math.max(...tally);
    let state: Settled;
    if (resolved) state = { result: resolved.decision, final: resolved.decision, resolvedBy: resolved.by, note: resolved.note, reason: resolved.reason };
    else if (!cast.length) state = { result: "waiting" };
    else if (screening.rule.settle === "one") state = given.length ? { result: given[0]!.decision, final: given[0]!.decision } : { result: "waiting" };
    else if (given.length < cast.length) state = { result: "waiting" };
    else if (screening.rule.settle === "all") state = top === given.length ? { result: given[0]!.decision, final: given[0]!.decision } : { result: "conflict" };
    // Most of them: more than half on one side. An even split has no side.
    else state = top * 2 > given.length ? { result: DECISIONS[tally.indexOf(top)]!, final: DECISIONS[tally.indexOf(top)]! } : { result: "conflict" };
    settled[paper.id] = state;
    counts[state.result]++;
  });
  return { papers, votes, settled, counts };
}

/** The passage a model quotes for its answer to a criterion, and why. */
export function evidence(paper: Paper, criterion: Criterion, criteria: Criterion[], answer: Answer) {
  const quote = paper.sentences[Math.min(criteria.indexOf(criterion), paper.sentences.length - 1)] ?? paper.title;
  const why = !paper.sentences.length ? "There is no abstract, so only the title could be read." : answer === "yes" ? "It reads this passage as meeting the criterion." : answer === "no" ? "It reads this passage as failing the criterion." : "It finds nothing in the text that settles this.";
  return { quote, why };
}

/** Cohen's kappa between two reviewers over the papers both voted on, with how many those were. */
export function agreement(a: string, b: string, state: Standing) {
  const both = state.papers.flatMap((paper) => {
    const [x, y] = [state.votes[paper.id]!.find((one) => one.reviewer.id === a)?.vote, state.votes[paper.id]!.find((one) => one.reviewer.id === b)?.vote];
    return x && y ? [[x.decision, y.decision] as const] : [];
  });
  if (!both.length) return null;
  const same = both.filter(([x, y]) => x === y).length / both.length;
  const chance = DECISIONS.reduce((sum, d) => sum + (both.filter(([x]) => x === d).length / both.length) * (both.filter(([, y]) => y === d).length / both.length), 0);
  return { papers: both.length, same, kappa: chance === 1 ? 1 : (same - chance) / (1 - chance) };
}

/**
 * What changing a screening does to its papers on their abstract: how many join or leave, how many
 * settled ones open again or end up somewhere else, and how many become settled. Shown before a
 * change is made, so nothing about it is a surprise.
 */
export function effectOf(before: Screening, after: Screening) {
  const [was, now] = [standing(before, "abstract"), standing(after, "abstract")];
  const out = { added: 0, removed: 0, reopened: 0, moved: 0, settled: 0 };
  for (const paper of now.papers) {
    const [x, y] = [was.settled[paper.id], now.settled[paper.id]!];
    if (!x) out.added++;
    else if (x.final && !y.final) out.reopened++;
    else if (x.final && y.final && x.final !== y.final) out.moved++;
    else if (!x.final && y.final) out.settled++;
  }
  out.removed = count(was.papers, (paper) => !now.settled[paper.id]);
  return out;
}

export const count = <T,>(list: T[], test: (item: T) => boolean) => list.reduce((n, item) => n + (test(item) ? 1 : 0), 0);

// ── What the mock starts with ────────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
/** The mock's "now", fixed so the server and the browser agree on every date. */
export const NOW = Date.UTC(2026, 10, 23, 13, 0);
let slots = 0;
const source = (id: string, kind: SourceKind, name: string, detail: string, total: number, duplicates: number, facts?: string[]): Source => ({ id, slot: slots++ % 12, kind, name, detail, total, scope: "all", range: [1, total], duplicates, addedAt: NOW - 6 * DAY, ...(facts ? { facts } : {}) });
const blank = () => ({ cast: { abstract: {}, fullText: {} }, resolved: { abstract: {}, fullText: {} }, fullTexts: {} });
export const DEFAULT_RULE: Rule = { each: "2", settle: "all", resolver: "amina", blind: "after" };
export const defaultScoring = (criteria: Criterion[]): Scoring => ({ points: Object.fromEntries(criteria.map((c) => [c.key, [1, 0, 0] as [number, number, number]])), minimum: criteria.filter((c) => c.must).length, stars: [1, 2, 3, 4, 5].map((k) => Math.max(1, Math.ceil((k / 5) * criteria.length))) });

function made(id: string, name: string, seed: number, sources: Source[], people: string[], models: number, progress: Record<string, number>, more: Partial<Screening> = {}): Screening {
  const reviewers = [...people.map((person) => personReviewer(personOf(person)!, NOW - 6 * DAY)), ...SEED_MODELS.slice(0, models).map((model) => modelReviewer(model, NOW - 6 * DAY))];
  const total = paperTotal(sources);
  const reached = Object.fromEntries(reviewers.map((reviewer) => [reviewer.id, Math.round(total * (progress[reviewer.id] ?? progress[reviewer.kind] ?? 1))]));
  return {
    id,
    name,
    createdBy: people[0] ?? "amina",
    createdAt: NOW - 6 * DAY,
    question: "",
    fullText: true,
    sources,
    criteria: DEFAULT_CRITERIA,
    reviewers,
    rule: { ...DEFAULT_RULE, resolver: people[0] ?? "amina", each: people.length > 1 ? "2" : "1" },
    scoring: defaultScoring(DEFAULT_CRITERIA),
    destination: { kind: "new", name: `Included in ${name}`, prune: false },
    seed,
    reached: { abstract: reached, fullText: Object.fromEntries(reviewers.map((reviewer) => [reviewer.id, 0])) },
    ...blank(),
    changes: [{ at: NOW - 6 * DAY, by: people[0] ?? "amina", what: "Started the screening" }],
    ...more,
  };
}

/** The screenings the mock opens with. The first is half way through; the others show the other states. */
export function startingScreenings(): Screening[] {
  const edtech = made(
    "edtech",
    "EdTech and foundational learning",
    1,
    [
      source("s1", "search", "tablet OR software AND literacy AND primary school", "Openscholar search", 75, 0),
      source("s2", "search", "EdTech numeracy sub-Saharan Africa", "Openscholar search", 38, 6),
      source("s3", "upload", "pubmed-export-2026-11.ris", "Reference file", 25, 5, ["22 found in Openscholar's index", "2 without an abstract"]),
      source("s4", "pdf", "7 PDFs from the team drive", "Read from the files", 7, 2, ["Titles and abstracts read from the files"]),
    ],
    ["amina", "jonas", "thandiwe"],
    3,
    { amina: 0.79, jonas: 1, thandiwe: 0.64, [modelReviewer(SEED_MODELS[2]!, 0).id]: 0.78 },
  );
  edtech.viewers = [personReviewer(personOf("rahul")!, NOW - 3 * DAY)];
  edtech.question = "Do digital tools improve foundational literacy and numeracy for primary-school children in sub-Saharan Africa?";
  // Full text has begun: the models are through, the people have started.
  edtech.reached.fullText = Object.fromEntries(edtech.reviewers.map((reviewer) => [reviewer.id, reviewer.kind === "model" ? 999 : reviewer.id === "jonas" ? 12 : reviewer.id === "amina" ? 6 : 0]));
  edtech.changes = [
    { at: NOW - 6 * DAY, by: "amina", what: "Started the screening", effect: "132 papers from 4 sources, 3 people and 2 models" },
    { at: NOW - 4 * DAY, by: "jonas", what: "Added the criterion “Is the intervention delivered with digital technology?”", effect: "Nice to have: no result changed" },
    { at: NOW - 2 * DAY, by: "amina", what: "Added a third model as a reviewer", effect: "It reads all 132 papers" },
    { at: NOW - DAY, by: "amina", what: "Moved the included papers on to full text" },
  ];
  // Half of the splits found so far were settled before the mock opens.
  const state = standing(edtech, "abstract");
  let n = 0;
  for (const paper of state.papers) {
    if (state.settled[paper.id]!.result !== "conflict" || n++ % 2) continue;
    const given = state.votes[paper.id]!.flatMap((one) => one.vote ?? []);
    const tally = DECISIONS.map((decision) => given.filter((vote) => vote.decision === decision).length);
    edtech.resolved.abstract[paper.id] = { decision: DECISIONS[tally.indexOf(Math.max(...tally))]!, by: "amina" };
  }
  return [
    edtech,
    made("tvet", "TVET and youth employment", 2, [source("t1", "search", "TVET AND youth employment AND Africa", "Openscholar search", 412, 0), source("t2", "collection", "Skills and work, shared reading", "Collection", 148, 31)], ["thandiwe", "amina", "kwame"], 2, { person: 0.55, model: 1 }, { createdAt: NOW - 12 * DAY }),
    made("girls", "Girls' secondary schooling and cash transfers", 3, [source("g1", "search", "cash transfer AND girls AND secondary school", "Openscholar search", 240, 0), source("g2", "zotero", "CCT review 2026", "Zotero group collection", 96, 22)], ["jonas", "leila", "rahul"], 1, { jonas: 0.7, leila: 0.2, rahul: 0.45, model: 0.6 }, { createdAt: NOW - 9 * DAY, paused: true, changes: [{ at: NOW - 9 * DAY, by: "jonas", what: "Started the screening" }, { at: NOW - 2 * DAY, by: "jonas", what: "Paused the models", effect: "They spend nothing until they are let on" }] }),
    // In another workspace, shared with the person the mock starts as: they vote, and its settings are that workspace's.
    made("remedial", "Remedial education, rapid review", 8, [source("r1", "search", "remedial education AND randomised", "Openscholar search", 133, 0)], ["sofia", "amina"], 1, { sofia: 0.8, amina: 0.3, model: 1 }, { createdBy: "sofia", createdAt: NOW - 5 * DAY, workspace: "lab", fullText: false }),
    made("teachers", "Teacher professional development", 4, [source("d1", "search", "teacher professional development AND learning outcomes", "Openscholar search", 640, 0)], [], 3, { model: 1 }, { createdBy: "kwame", createdAt: NOW - 15 * DAY, rule: { each: "1", settle: "all", resolver: "kwame", blind: "after" } }),
    made("climate", "Climate adaptation in schools", 5, [source("c1", "collection", "Climate and schooling", "Collection", 188, 0)], ["amina", "jonas"], 0, { person: 1 }, { createdAt: NOW - 40 * DAY, finishedAt: NOW - 11 * DAY, fullText: false }),
    made("ecd", "Early childhood development and home visits", 6, [source("e1", "search", "home visiting AND early childhood development", "Openscholar search", 380, 0), source("e2", "upload", "ecd-scopus.ris", "Reference file", 120, 44)], ["thandiwe", "amina"], 2, { person: 1, model: 1 }, { createdBy: "thandiwe", createdAt: NOW - 60 * DAY, finishedAt: NOW - 21 * DAY }),
    made("nutrition", "School nutrition and attendance", 7, [source("n1", "saved", "All saved papers", "This workspace's library", 187, 0)], ["jonas"], 1, { person: 1, model: 1 }, { createdBy: "jonas", createdAt: NOW - 70 * DAY, finishedAt: NOW - 26 * DAY, fullText: false, rule: { each: "1", settle: "one", resolver: "jonas", blind: "always" } }),
  ].map((screening) => {
    // A finished screening with a full-text stage was read through at that stage too.
    if (!screening.finishedAt || !screening.fullText) return screening;
    return { ...screening, reached: { ...screening.reached, fullText: Object.fromEntries(screening.reviewers.map((reviewer) => [reviewer.id, 9999])) } };
  });
}

/** A date as the mock shows it: how long ago for the last week, the day before that. */
export function ago(at: number) {
  const minutes = Math.max(0, Math.round((NOW - at) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  const days = Math.round(minutes / (24 * 60));
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}
