// Mock data for the assistant design. Queries and result counts are real OpenAlex
// data (title-and-abstract search, 2026-09-30). Screening decisions and extraction
// values were read from each paper's OpenAlex abstract. Credit figures and the
// library are made up for the mock.

import type { ComponentType } from "react";
import { Compass, FileText, FolderPlus, LibraryBig, ListChecks, PenLine, Rocket, Search, TableProperties, TestTubes } from "lucide-react";

export type Decision = "include" | "exclude" | "unsure";

export const ORIGINAL_COUNT = 215;

export const TIGHT_COUNT = 24;

/** The versions the assistant tried, with their real counts. */
export const VERSIONS = [
  { label: "Add synonyms", count: 43 },
  { label: "Articles since 2015", count: 28 },
  { label: "Sub-Saharan Africa", count: 24 },
];

/**
 * Every decision, in the order OpenAlex returns the 24 (the page shows the first 8).
 * Included: the Kenya trial, a storybook RCT, the Ghana bilingual RCT, and a Ghana
 * quasi-experiment that OpenAlex lists twice. Unclear: one with no abstract, and two
 * reports on a trial that aren't trials themselves, which the assistant then settles.
 */
export const SCREEN_ORDER: Decision[] = [
  "include", "unsure", "exclude", "exclude", "exclude", "unsure", "unsure", "exclude",
  "exclude", "exclude", "exclude", "exclude", "exclude", "include", "exclude", "exclude",
  "include", "exclude", "include", "include", "exclude", "exclude", "exclude", "exclude",
];
/** The included studies once the duplicate is counted once. */
export const COLLECTED = 4;
/** Unclear papers the assistant settles itself after the screening: both report on a trial without being one. */
export const SETTLED = 2;
/**
 * Credits a job holds before it runs, from the real estimators: screening holds 4.5 per
 * paper (`ESTIMATED_CREDITS_PER_PAPER`), extraction 5 per question per paper at its high
 * estimate (`estimatePaperCredits`). What a job actually spends is made up for the mock;
 * the rest of the hold comes back when it ends.
 */
export const SCREEN_HOLD = 24 * 4.5;
export const SCREEN_SPENT = 62;
export const EXTRACT_HOLD = 3 * 4 * 5;
export const EXTRACT_SPENT = 17;
/** Credits one reply may spend on its own AI use before it pauses; set per chat, made up here. */
export const REPLY_CAP = 15;
/** Enough to screen, then short of the extraction's hold, so the top-up shows. */
export const BALANCE = 120;
export const COLLECTION_NAME = "Structured pedagogy trials, sub-Saharan Africa";

export type Ico = ComponentType<{ className?: string }>;

/** One tint per kind of work, the way the model map gives each provider one. */
export const KIND: Record<string, { icon: Ico; tint: string }> = {
  search: { icon: Search, tint: "#60a5fa" },
  versions: { icon: TestTubes, tint: "#60a5fa" },
  write: { icon: PenLine, tint: "var(--primary)" },
  screening: { icon: ListChecks, tint: "#a78bfa" },
  extraction: { icon: TableProperties, tint: "#fb923c" },
  collection: { icon: FolderPlus, tint: "#2dd4bf" },
  navigate: { icon: Compass, tint: "#94a3b8" },
  library: { icon: LibraryBig, tint: "#f472b6" },
  publish: { icon: Rocket, tint: "var(--primary)" },
  paper: { icon: FileText, tint: "#eab308" },
};

/** One extracted value; `missing` when the abstract doesn't say. */
export type Cell = { value: string; missing?: boolean };
export type ExtractRow = { cite: number; paper: string; design: Cell; setting: Cell; sample: Cell; titleOnly?: boolean };

export const EXTRACT_FIELDS = [
  { key: "design", label: "Design" },
  { key: "setting", label: "Setting" },
  { key: "sample", label: "Sample" },
] as const;

/** Read from each paper's abstract; nothing here is filled in beyond what it says. */
export const EXTRACT_ROWS: ExtractRow[] = [
  {
    cite: 1, paper: "Piper, Zuilkowski and Dubeck, 2018",
    design: { value: "RCT, 3 arms and a control" }, setting: { value: "Kenya, grades 1 and 2" }, sample: { value: "Not in the abstract", missing: true },
  },
  {
    cite: 2, paper: "Fleisch and Schöer, 2022",
    design: { value: "RCT, per its title" }, setting: { value: "No abstract", missing: true }, sample: { value: "No abstract", missing: true }, titleOnly: true,
  },
  {
    cite: 3, paper: "Lee, Moussa and Zuilkowski, 2026",
    design: { value: "Randomized trial" }, setting: { value: "Ghana, grades 2 and 3" }, sample: { value: "3,559 students, 198 schools" },
  },
  {
    cite: 4, paper: "Agyeman-Badu, 2022",
    design: { value: "Quasi-experiment, matched control" }, setting: { value: "Ghana, primary" }, sample: { value: "2,400 pupils, 80 schools" },
  },
];

export const LIBRARY = {
  name: "Foundational Learning Evidence",
  // Libraries live at <name>-lib.<platform domain>; shared dev's platform domain is opendev.space.
  address: "foundational-learning-evidence-lib.opendev.space",
  tagline: "Structured pedagogy for early grade reading in sub-Saharan Africa",
  description:
    "Trials and quasi-experiments on structured pedagogy, coaching and teacher guides for early grade reading across sub-Saharan Africa, screened by the OpenDevEd team.",
  collections: ["Mother-tongue instruction", "Teacher coaching"],
};

/**
 * The screening already running in another chat. The plan runs one screening at a
 * time, so a new one waits for it. The same job shows in the history sheet.
 */
export const OTHER_SCREENING = { chat: "Teacher coaching cost-effectiveness", start: 126, total: 140 };

/** Where the included studies can go when the assistant asks. */
export const COLLECTION_CHOICES = [
  { id: "new", name: COLLECTION_NAME, detail: "A new collection", count: 0 },
  { id: "coaching", name: "Teacher coaching", detail: "12 papers", count: 12 },
  { id: "mother", name: "Mother-tongue instruction", detail: "8 papers", count: 8 },
] as const;

/** The search the first message means, found in your history. */
export const SEARCH_NAME = "structured pedagogy early grade reading";

/**
 * What the assistant can search in your account, one branch per kind, each with
 * its newest record. The counts are made up for the mock; the names are its data.
 */
export const ACCOUNT: Array<{ kind: keyof typeof KIND; title: string; latest: string }> = [
  { kind: "search", title: "12 searches", latest: SEARCH_NAME },
  { kind: "collection", title: "3 collections", latest: "Teacher coaching" },
  { kind: "paper", title: "48 saved papers", latest: EXTRACT_ROWS[0]!.paper },
  { kind: "library", title: "1 Evidence Library", latest: LIBRARY.name },
];

/** Something in your account a message can point at with @. Made up for the mock, apart from the papers. */
export type Mentionable = { id: string; kind: keyof typeof KIND; label: string; detail: string };

export const MENTIONABLE: Mentionable[] = [
  { id: "s1", kind: "search", label: SEARCH_NAME, detail: "Search, 215 results" },
  { id: "s2", kind: "search", label: "mother-tongue instruction Kenya Uganda", detail: "Search, 142 results" },
  { id: "s3", kind: "search", label: "teacher coaching cost-effectiveness", detail: "Search, 140 results" },
  { id: "c1", kind: "collection", label: "Teacher coaching", detail: "Collection, 12 papers" },
  { id: "c2", kind: "collection", label: "Mother-tongue instruction", detail: "Collection, 8 papers" },
  { id: "c3", kind: "collection", label: "EGRA validity studies", detail: "Collection, 12 papers" },
  { id: "l1", kind: "library", label: LIBRARY.name, detail: "Evidence Library" },
  ...EXTRACT_ROWS.map((row) => ({ id: `p${row.cite}`, kind: "paper" as const, label: row.paper, detail: "Saved paper" })),
];
