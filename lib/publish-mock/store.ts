// MOCK (mock/publish-reports): the Publish mock's store, one JSON file in the checkout, read and written by its server
// actions. The real build keeps all of this in Convex.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Check, CheckResult, Metadata, MockState, Settings, Submission } from "./types";
import { countriesIn, keywordsFrom, suggestSdgs } from "./read";
import { suggestTopics } from "./topics";
import { mail } from "./emails";
import { DEFAULT_LLM, JEV, doiOf, providersOf, registrationOf } from "./types";

export const MOCK_DIR = path.join(process.cwd(), ".publish-mock");
const FILE = path.join(MOCK_DIR, "state.json");
export const pdfPath = (key: string) => path.join(MOCK_DIR, `${key}.pdf`);
export const coverPath = (key: string) => path.join(MOCK_DIR, `${key}.cover.jpg`);
export const textPath = (key: string) => path.join(MOCK_DIR, `${key}.txt`);

/**
 * Whether a report's PDF and cover may be read: anyone reads a live report's, and only its author reads one that
 * isn't live yet or didn't pass. `public` says which, for how the file may be cached.
 */
export async function fileAccess(key: string, userId: string | null): Promise<{ public: boolean } | null> {
  if (!/^R\d+$/.test(key)) return null;
  const report = (await readState()).submissions.find((s) => s.id === key);
  if (!report) return null;
  if (report.status === "live") return { public: true };
  return report.demo || (userId !== null && report.ownerId === userId) ? { public: false } : null;
}

const DAY = 86_400_000;

const CHECKS: Check[] = [
  {
    id: "byline",
    name: "Byline and DOI in the PDF",
    question: "Does the text include this line, allowing for line breaks and spacing: \"{byline}\"?",
    model: JEV,
    threshold: 0.8,
    blocking: true,
    enabled: true,
  },
  {
    id: "published",
    name: "Already published",
    question: "Is this report the same work as the record found?",
    model: DEFAULT_LLM,
    threshold: 0.5,
    // A match goes to a reviewer: the author may be the one who published it.
    blocking: false,
    enabled: true,
    builtIn: "already-published",
  },
  {
    id: "harm",
    name: "No hate speech or harassment",
    question: "Is the text free of hate speech, harassment and threats against people? Research that studies these as its subject is fine.",
    model: JEV,
    threshold: 0.7,
    blocking: true,
    enabled: true,
  },
  {
    id: "research",
    name: "Research, not advertising",
    question: "Is this a research output, rather than an advertisement, a sales brochure or a page that mostly links to unrelated sites?",
    model: DEFAULT_LLM,
    threshold: 0.7,
    blocking: false,
    enabled: true,
  },
];

/** MOCK: the sandbox account's details, which the real build reads from the server as a community's settings do
 * (`EL_CROSSREF_SANDBOX_*`). The prefix is shared dev's. */
export const CROSSREF_SANDBOX = { prefix: "10.53832", depositorName: "Openscholar sandbox", email: "sandbox@openscholar.ai", registrant: "Openscholar" };

async function seedSettings(): Promise<Settings> {
  const text = await readFile(path.join(process.cwd(), "lib/publish-mock/agreement.md"), "utf8");
  return {
    enabled: true,
    humanReview: true,
    series: { name: "Openscholar Reports", issn: "", byline: "This publication is an Openscholar Report, ISSN {issn}, {doi}" },
    // Both on their sandboxes, and one DOI for each report: Crossref's, with the file archived on Zenodo under it.
    publication: {
      zenodo: { mode: "sandbox", license: "cc-by-4.0", defaultIdentifierPolicy: "reuse-crossref" },
      crossref: { mode: "sandbox", suffixNamespace: "openscholar-r", ...CROSSREF_SANDBOX },
    },
    publicationSavedAt: Date.now() - 6 * DAY,
    metadataModel: DEFAULT_LLM,
    checks: CHECKS,
    checksVersion: 3,
    agreement: { version: 2, updatedAt: Date.now() - 6 * DAY, source: "end-user-agreements/publishing-agreement-single-work.md", text },
  };
}

const PEOPLE = [
  ["Amina Okafor", "University of Ibadan", "NG"],
  ["Joseph Mwangi", "Kenyatta University", "KE"],
  ["Thandiwe Banda", "University of Malawi", "MW"],
  ["Youssef El Amrani", "Mohammed V University", "MA"],
  ["Grace Nakato", "Makerere University", "UG"],
  ["Samuel Tesfaye", "Addis Ababa University", "ET"],
  ["Neema Mollel", "University of Dar es Salaam", "TZ"],
  ["Kwame Asante", "University of Ghana", "GH"],
] as const;

const TITLES = [
  "Teacher professional development through WhatsApp groups in rural Malawi",
  "Flood early warning and school attendance in the Rufiji basin",
  "Low-cost tablets for foundational numeracy: a two-year follow-up",
  "Climate adaptation plans in Moroccan oasis communities",
  "Girls' secondary school completion after the 2024 fee waiver in Uganda",
  "Mobile money transfers and household food security in Kenya",
  "Mother-tongue instruction in early grades: evidence from Ethiopia",
  "Heat stress and learning outcomes in northern Ghana",
  "Community radio for out-of-school children during school closures",
  "Drought insurance uptake among smallholder farmers in Tanzania",
  "Structured pedagogy at scale: lessons from Nigeria's state programmes",
  "Wealth gaps in access to tertiary education across East Africa",
  "AI tutors in under-resourced secondary schools: a pilot in Kampala",
  "Water harvesting and girls' time use in semi-arid Kenya",
];

const STATES: Array<Pick<Submission, "status" | "step" | "deposit" | "approved"> & { note?: string; failed?: string }> = [
  { status: "passed", step: "done", deposit: "none" },
  { status: "passed", step: "done", deposit: "none", approved: true },
  { status: "live", step: "done", deposit: "deposited" },
  { status: "failed", step: "done", deposit: "none", failed: "byline" },
  { status: "live", step: "done", deposit: "queued" },
  { status: "live", step: "done", deposit: "deposited" },
  { status: "declined", step: "done", deposit: "none", note: "A copy of a report already published by the ministry. Ask the ministry to co-publish it instead." },
  { status: "live", step: "done", deposit: "failed" },
  { status: "passed", step: "done", deposit: "none", failed: "published" },
  { status: "live", step: "done", deposit: "deposited" },
  { status: "failed", step: "done", deposit: "none", failed: "byline" },
  { status: "live", step: "done", deposit: "deposited" },
  { status: "live", step: "done", deposit: "deposited" },
  { status: "live", step: "done", deposit: "deposited" },
];

/** A report's key: R and six digits, counted up from the seed's. */
export const keyOf = (n: number) => `R${String(100_000 + n).padStart(6, "0")}`;

const ABSTRACT =
  "This report studies a programme run across 42 schools and their communities over two years. We combine records from the schools with interviews of teachers, parents and district officers. The findings point to low-cost changes that districts can make within existing budgets, and to where the evidence is still thin.";
const FUNDERS = ["Jacobs Foundation", "Foreign, Commonwealth & Development Office", "Wellcome Trust"];

async function seedMetadata(n: number, at: number, people: Array<{ name: string; affiliation: string; country: string }>): Promise<Metadata> {
  const text = `${TITLES[n]} ${ABSTRACT}`;
  const named = countriesIn(TITLES[n]!);
  return {
    title: TITLES[n]!,
    subtitle: "",
    type: "report",
    language: "en",
    date: new Date(at).toISOString().slice(0, 10),
    licence: "CC BY 4.0",
    authors: people.map((p, i) => ({
      name: p.name,
      orcid: i === 0 ? `0000-0002-${String(1000 + n * 37).slice(0, 4)}-${String(2000 + n * 91).slice(0, 4)}` : "",
      openalexId: null,
      affiliations: [{ id: null, name: p.affiliation, country: p.country }],
      corresponding: i === 0,
      roles: i === 0 ? ["Conceptualization", "Investigation", "Writing, original draft"] : ["Formal analysis", "Writing, review and editing"],
    })),
    abstract: ABSTRACT,
    topics: await suggestTopics(TITLES[n]!),
    keywords: keywordsFrom(TITLES[n]!, 3),
    sdgs: suggestSdgs(text),
    studyDesigns: n % 3 === 0 ? ["observational-study"] : n % 3 === 1 ? ["randomized-controlled-trial"] : [],
    countries: named.length ? named : [people[0]!.country],
    funding: n % 2 === 0 ? [{ funder: { id: null, name: FUNDERS[n % 3]! }, awards: [`${2023 + (n % 3)}-${1100 + n * 7}`] }] : [],
    references: ["10.1016/j.ijedudev.2021.102438", "10.1093/wber/lhz027", "10.1257/app.20180207"].slice(0, 1 + (n % 3)),
    relations: n % 4 === 0 ? [{ kind: "data", target: `https://zenodo.org/records/${8_100_000 + n}` }] : [],
  };
}

async function seedSubmission(settings: Settings, n: number): Promise<Submission> {
  const [name, affiliation, country] = PEOPLE[n % PEOPLE.length]!;
  const [second, secondAffiliation, secondCountry] = PEOPLE[(n + 3) % PEOPLE.length]!;
  const state = STATES[n]!;
  const id = keyOf(n + 1);
  const at = Date.now() - (n + 1) * 0.8 * DAY;
  const results = settings.checks.map((check): CheckResult => {
    const fails = state.failed === check.id;
    const base = { checkId: check.id, name: check.name, model: check.model.name, pass: !fails, blocking: check.blocking };
    if (check.builtIn === "already-published") {
      return fails
        ? { ...base, evidence: { title: TITLES[n]!, url: "https://usaid.openscholar.ai/lib/6XBK3HE5", where: "USAID" }, reasoning: "The same study: the same programme, districts and findings, under a shorter title." }
        : { ...base, detail: "Not in OpenAlex, Openscholar's index or our communities." };
    }
    const confidence = fails ? 0.04 : 0.86 + (n % 4) * 0.03;
    return {
      ...base,
      answer: fails ? "no" : "yes",
      confidence,
      threshold: check.threshold,
      ...(check.model.id === JEV.id ? {} : { reasoning: "A study with a method, data and findings. It names no product and links only to the data repository." }),
    };
  });
  return {
    id,
    doi: doiOf(settings, id),
    ...state,
    registration: registrationOf(settings),
    archive: state.status !== "live" ? "draft" : state.deposit === "deposited" ? "archived" : "queued",
    activatedAt: at,
    // A few with each status show as the viewer's own on Your reports.
    ...([0, 3, 5, 6, 8].includes(n) ? { demo: true } : {}),
    signedBy: { name, email: `${name.split(" ")[0]!.toLowerCase()}@example.org`, onBehalfOfAll: true },
    signedAt: at,
    agreementVersion: n < 9 ? 2 : 1,
    checksVersion: n < 6 ? 3 : 2,
    pdf: { name: `${TITLES[n]!.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}.pdf`, pages: 18 + ((n * 7) % 40), bytes: 1_200_000 + n * 310_000 },
    metadata: await seedMetadata(n, at, [
      { name, affiliation, country },
      { name: second, affiliation: secondAffiliation, country: secondCountry },
    ]),
    results,
    ...(state.note ? { note: state.note } : {}),
    createdAt: at,
    updatedAt: at,
  };
}

async function seed(): Promise<MockState> {
  const settings = await seedSettings();
  const state: MockState = { settings, submissions: await Promise.all(TITLES.map((_, n) => seedSubmission(settings, n))), drafts: {}, checkVersions: { "3": settings.checks } };
  // The sample whose registration was refused told the team's inbox, as a real refusal would.
  for (const report of state.submissions) if (report.deposit === "failed" || report.archive === "failed") mail(state, "registration-refused", report, "");
  return state;
}

/** MOCK: Crossref takes a little while; a report sent over 15 seconds ago is registered. */
/** MOCK: how long each registration takes. The real ones answer in seconds to minutes. */
const STEP_MS = 7_000;

/** Moves a live report's registrations on, in their order: each is done its turn after the report was activated. */
function settle(state: MockState) {
  for (const s of state.submissions) {
    if (s.status !== "live") continue;
    const since = Date.now() - (s.activatedAt ?? s.updatedAt);
    for (const [i, provider] of providersOf(s).entries()) {
      const due = since > STEP_MS * (i + 1);
      if (provider === "crossref" && s.deposit === "queued" && due) s.deposit = "deposited";
      if (provider === "zenodo" && s.archive === "queued" && due) s.archive = "archived";
      // The next one waits for this one.
      if ((provider === "crossref" ? s.deposit : s.archive) !== (provider === "crossref" ? "deposited" : "archived")) break;
    }
  }
}

export async function readState(): Promise<MockState> {
  try {
    const state = JSON.parse(await readFile(FILE, "utf8")) as MockState;
    // Settled on every read; saved with the next change, so a read never writes.
    settle(state);
    return state;
  } catch {
    const state = await seed();
    await writeState(state);
    return state;
  }
}

/** The whole file at once: written beside it, then renamed over it, so a reader never sees half of it. */
export async function writeState(state: MockState) {
  await mkdir(MOCK_DIR, { recursive: true });
  const temporary = `${FILE}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2));
  await rename(temporary, FILE);
}

// ponytail: one queue in this process; the real build's Convex mutations are transactions, so this goes with the mock.
let queue: Promise<unknown> = Promise.resolve();

/** Reads the store, applies `edit` and saves it, one change at a time, so two changes never overwrite each other. */
export function changeState<T>(edit: (state: MockState) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const state = await readState();
    const out = await edit(state);
    await writeState(state);
    return out;
  });
  queue = run.catch(() => undefined);
  return run;
}

/** The next report key, after every key in the store. */
export function nextKey(state: MockState) {
  const highest = Math.max(0, ...state.submissions.map((s) => Number(s.id.slice(1)) - 100_000));
  return keyOf(highest + 1);
}
