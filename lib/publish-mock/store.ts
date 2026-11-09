// MOCK (mock/publish-reports): the Publish mock's store, one JSON file in the checkout, read and written by its server
// actions. The real build keeps all of this in Convex.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Check, MockState, Settings, Submission } from "./types";
import { doiOf } from "./types";

export const MOCK_DIR = path.join(process.cwd(), ".publish-mock");
const FILE = path.join(MOCK_DIR, "state.json");
export const pdfPath = (key: string) => path.join(MOCK_DIR, `${key}.pdf`);

const DAY = 86_400_000;

const CHECKS: Check[] = [
  { id: "byline", name: "Byline and DOI in the PDF", engine: "decision", decisionModel: "text-match", instructions: "{byline}", threshold: 1, direction: "atLeast", blocking: true, enabled: true },
  { id: "similarity", name: "Plagiarism", engine: "decision", decisionModel: "similarity-check", instructions: "Compare the full text with published work. Quotes and references are left out.", threshold: 0.25, direction: "atMost", blocking: true, enabled: true },
  { id: "moderation", name: "Hate speech and harassment", engine: "decision", decisionModel: "omni-moderation", instructions: "Flag hate, harassment, threats and violence.", threshold: 0.2, direction: "atMost", blocking: true, enabled: true },
  {
    id: "advertising",
    name: "Advertising and spam",
    engine: "llm",
    llm: { id: "google/gemini-3-flash-preview", name: "Gemini 3 Flash Preview", inputPricePerMillion: 0.5, outputPricePerMillion: 3 },
    instructions: "Is this a research output, or does it mainly sell a product or service, or link to unrelated sites? Answer with how likely it is research, from 0 to 1.",
    threshold: 0.7,
    direction: "atLeast",
    blocking: false,
    enabled: true,
  },
];

async function seedSettings(): Promise<Settings> {
  const text = await readFile(path.join(process.cwd(), "lib/publish-mock/agreement.md"), "utf8");
  return {
    enabled: true,
    humanReview: true,
    // Crossref's test prefix: every DOI here is a sandbox one.
    series: { name: "Openscholar Reports", issn: "", prefix: "10.5555", suffix: "openscholar-r.{key}", byline: "This publication is an Openscholar Report, ISSN {issn}, {doi}" },
    crossref: "sandbox",
    metadataModel: { id: "google/gemini-3-flash-preview", name: "Gemini 3 Flash Preview", inputPricePerMillion: 0.5, outputPricePerMillion: 3 },
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

const STATES: Array<Pick<Submission, "status" | "step" | "deposit"> & { note?: string; failed?: string }> = [
  { status: "review", step: "done", deposit: "none" },
  { status: "review", step: "done", deposit: "none" },
  { status: "live", step: "done", deposit: "deposited" },
  { status: "failed", step: "done", deposit: "none", failed: "byline" },
  { status: "live", step: "done", deposit: "queued" },
  { status: "live", step: "done", deposit: "deposited" },
  { status: "declined", step: "done", deposit: "none", note: "A copy of a report already published by the ministry. Ask the ministry to co-publish it instead." },
  { status: "live", step: "done", deposit: "failed" },
  { status: "review", step: "done", deposit: "none" },
  { status: "live", step: "done", deposit: "deposited" },
  { status: "failed", step: "done", deposit: "none", failed: "similarity" },
  { status: "live", step: "done", deposit: "deposited" },
  { status: "live", step: "done", deposit: "deposited" },
  { status: "live", step: "done", deposit: "deposited" },
];

/** A report's key: R and six digits, counted up from the seed's. */
export const keyOf = (n: number) => `R${String(100_000 + n).padStart(6, "0")}`;

function seedSubmission(settings: Settings, n: number): Submission {
  const [name, affiliation, country] = PEOPLE[n % PEOPLE.length]!;
  const [second, secondAffiliation, secondCountry] = PEOPLE[(n + 3) % PEOPLE.length]!;
  const state = STATES[n]!;
  const id = keyOf(n + 1);
  const at = Date.now() - (n + 1) * 0.8 * DAY;
  const results = settings.checks.map((check) => {
    const fails = state.failed === check.id;
    const score = check.direction === "atMost" ? (fails ? 0.41 : 0.04 + (n % 4) * 0.03) : fails ? 0 : check.engine === "llm" ? 0.91 : 1;
    return {
      checkId: check.id,
      name: check.name,
      engine: check.engine,
      pass: !fails,
      score,
      threshold: check.threshold,
      direction: check.direction,
      blocking: check.blocking,
      ...(check.engine === "llm" ? { reasoning: "A study with a method, data and findings. It names no product and links only to the data repository." } : {}),
    };
  });
  return {
    id,
    doi: doiOf(settings, id),
    ...state,
    signedBy: { name, email: `${name.split(" ")[0]!.toLowerCase()}@example.org`, onBehalfOfAll: true },
    signedAt: at,
    agreementVersion: n < 9 ? 2 : 1,
    checksVersion: n < 6 ? 3 : 2,
    pdf: { name: `${TITLES[n]!.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}.pdf`, pages: 18 + ((n * 7) % 40), bytes: 1_200_000 + n * 310_000 },
    metadata: {
      title: TITLES[n]!,
      authors: [
        { name, orcid: `0000-0002-${String(1000 + n * 37).slice(0, 4)}-${String(2000 + n * 91).slice(0, 4)}`, affiliation, country },
        { name: second, orcid: "", affiliation: secondAffiliation, country: secondCountry },
      ],
      abstract:
        "This report studies a programme run across 42 schools and their communities over two years. We combine records from the schools with interviews of teachers, parents and district officers. The findings point to low-cost changes that districts can make within existing budgets, and to where the evidence is still thin.",
      keywords: ["education", "low-income countries", "evaluation"],
      language: "English",
      date: new Date(at).toISOString().slice(0, 10),
      licence: "CC BY 4.0",
    },
    results,
    ...(state.note ? { note: state.note } : {}),
    createdAt: at,
    updatedAt: at,
  };
}

async function seed(): Promise<MockState> {
  const settings = await seedSettings();
  return { settings, submissions: TITLES.map((_, n) => seedSubmission(settings, n)), draftId: null, checkVersions: { "3": settings.checks } };
}

/** MOCK: Crossref takes a little while; a report sent over 15 seconds ago is registered. */
function settle(state: MockState) {
  let changed = false;
  for (const s of state.submissions) {
    if (s.deposit === "queued" && Date.now() - s.updatedAt > 15_000) {
      s.deposit = "deposited";
      changed = true;
    }
  }
  return changed;
}

export async function readState(): Promise<MockState> {
  try {
    const state = JSON.parse(await readFile(FILE, "utf8")) as MockState;
    if (settle(state)) await writeState(state);
    return state;
  } catch {
    const state = await seed();
    await writeState(state);
    return state;
  }
}

export async function writeState(state: MockState) {
  await mkdir(MOCK_DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(state, null, 2));
}

/** The next report key, after every key in the store. */
export function nextKey(state: MockState) {
  const highest = Math.max(0, ...state.submissions.map((s) => Number(s.id.slice(1)) - 100_000));
  return keyOf(highest + 1);
}
