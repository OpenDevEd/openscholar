// What the screening form offers to pick from, made up: places papers can come from, the
// collections included papers can go to, and the questions a search already asks.

import type { SourceKind } from "./data";

export type Offer = { name: string; detail: string; total: number; questions?: string[]; /** A search's filters. */ filters?: string[]; /** The kind it is added as, where that is not its tab's: the whole library sits above its collections. */ kind?: SourceKind };

export const OFFERS: Record<Exclude<SourceKind, "upload" | "pdf" | "dois" | "evidenceLibrary" | "saved">, Offer[]> = {
  search: [
    { name: "structured pedagogy AND early grade reading", detail: "Searched yesterday", total: 318, filters: ["2010 to 2026", "Articles", "Open access"], questions: ["Does the study report reading outcomes?", "Was the programme delivered by government teachers?"] },
    { name: "teaching at the right level", detail: "Searched 3 days ago", total: 96, filters: ["2015 to 2026"] },
    { name: "school feeding AND learning outcomes", detail: "Searched 16 Nov", total: 207, filters: ["Articles and reviews", "English"] },
    { name: "tablet OR software AND literacy AND primary school", detail: "Searched 16 Nov", total: 75, questions: ["Is the intervention delivered with digital technology?"] },
    { name: "EdTech numeracy sub-Saharan Africa", detail: "Searched 9 Nov", total: 38 },
    { name: "mother tongue instruction AND reading fluency", detail: "Searched 9 Nov", total: 164 },
    { name: "teacher coaching AND classroom practice", detail: "Searched 2 Nov", total: 251, filters: ["2018 to 2026", "Open access"] },
    { name: "cash transfer AND girls AND secondary school", detail: "Searched 20 Oct", total: 240 },
    { name: "home visiting AND early childhood development", detail: "Searched 20 Oct", total: 380 },
    { name: "radio instruction AND primary education", detail: "Searched 20 Oct", total: 52 },
    { name: "TVET AND youth employment AND Africa", detail: "Searched 22 Sep", total: 412 },
    { name: "remedial education AND randomised", detail: "Searched 22 Sep", total: 133 },
  ],
  collection: [
    { name: "All saved papers", detail: "This workspace's library", total: 412, kind: "saved" },
    { name: "Foundational learning, core set", detail: "Yours, updated 2 days ago", total: 64 },
    { name: "To read: numeracy", detail: "Yours, updated yesterday", total: 23 },
    { name: "Skills and work, shared reading", detail: "Shared by Jonas Becker", total: 148 },
    { name: "Climate and schooling", detail: "Shared by Thandiwe Nkosi", total: 188 },
    { name: "Girls' education, 2020 onwards", detail: "Yours, updated 12 Nov", total: 71 },
    { name: "Methods: cluster trials", detail: "Shared by Kwame Mensah", total: 12 },
    { name: "Empty for now", detail: "Yours, made 3 Nov", total: 0 },
  ],
  screening: [
    { name: "Included in TVET and youth employment", detail: "Finished screening", total: 61 },
    { name: "Included in Climate adaptation in schools", detail: "Finished screening", total: 29 },
    { name: "Included in Early childhood development and home visits", detail: "Finished screening", total: 74 },
  ],
  zotero: [
    { name: "My library", detail: "Your Zotero account", total: 934 },
    { name: "Literacy review 2026", detail: "Group collection", total: 154 },
    { name: "CCT review 2026", detail: "Group collection", total: 96 },
  ],
};

/** What a community offers to screen: all of it, its own collections, yours in it, and the ones shared with you. */
export type CommunityRow = { name: string; total: number; group: "yours" | "shared" | "library"; access?: "editor" | "viewer"; private?: boolean; parent?: string; pasted?: boolean };
export const COMMUNITIES: Array<{ id: string; name: string; role: string; records: number; /** Where the community lives: its collections open under it. */ address: string; rows: CommunityRow[] }> = [
  {
    id: "hub",
    name: "EdTech Hub Evidence Community",
    role: "Editor",
    address: "https://edtechhub.openscholar.ai",
    records: 1280,
    rows: [
      { name: "Every record in EdTech Hub Evidence Community", total: 1280, group: "library" },
      { name: "Sub-Saharan Africa", total: 342, group: "library", parent: "Regions" },
      { name: "Foundational learning", total: 118, group: "library", parent: "Topics" },
      { name: "Girls' education", total: 96, group: "library", parent: "Topics" },
      { name: "My reading list for the EdTech review", total: 46, group: "yours", private: true },
      { name: "Radio and audio, for the brief", total: 19, group: "yours", private: false },
      { name: "Tablet programmes", total: 31, group: "shared", access: "viewer", private: true },
      { name: "Teacher coaching, working set", total: 74, group: "shared", access: "editor", private: false },
    ],
  },
  {
    id: "aerd",
    name: "African Education Research Database",
    role: "Viewer",
    address: "https://aerd.openscholar.ai",
    records: 2140,
    rows: [
      { name: "Every record in African Education Research Database", total: 2140, group: "library" },
      { name: "Kenya", total: 318, group: "library", parent: "Countries" },
      { name: "Ghana", total: 241, group: "library", parent: "Countries" },
      { name: "Early grade reading", total: 205, group: "library", parent: "Topics" },
    ],
  },
];

export const COLLECTIONS = [
  { id: "c1", name: "Foundational learning, core set", papers: 64 },
  { id: "c2", name: "To read: numeracy", papers: 23 },
  { id: "c3", name: "Skills and work, shared reading", papers: 148 },
  { id: "c4", name: "Girls' education, 2020 onwards", papers: 71 },
  { id: "c5", name: "Methods: cluster trials", papers: 12 },
];
export const COMMUNITY_COLLECTIONS = [
  { id: "e1", name: "EdTech Hub: Sub-Saharan Africa", papers: 342 },
  { id: "e2", name: "EdTech Hub: Foundational learning", papers: 118 },
];

/** Criteria a model writes from a research question. */
export const WRITTEN = ["Is the study published in 2010 or later?", "Is the paper written in English or French?", "Does the study report a comparison group?"];

/** File endings the upload reads as references, and as papers. */
export const REFERENCE_FILES = /\.(ris|bib|enw|nbib|xml|ciw|csv|txt)$/i;
export const PDF_FILES = /\.pdf$/i;
