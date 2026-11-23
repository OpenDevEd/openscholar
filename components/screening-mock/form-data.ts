// What the screening form offers to pick from, made up: places papers can come from, the
// collections included papers can go to, and the questions a search already asks.

import type { SourceKind } from "./data";

export type Offer = { name: string; detail: string; total: number; questions?: string[]; /** A search's filters. */ filters?: string[] };

export const OFFERS: Record<Exclude<SourceKind, "upload" | "pdf" | "dois">, Offer[]> = {
  search: [
    { name: "structured pedagogy AND early grade reading", detail: "Searched yesterday", total: 318, filters: ["2010 to 2026", "Articles", "Open access"], questions: ["Does the study report reading outcomes?", "Was the programme delivered by government teachers?"] },
    { name: "teaching at the right level", detail: "Searched 3 days ago", total: 96, filters: ["2015 to 2026"] },
    { name: "school feeding AND learning outcomes", detail: "Searched last week", total: 207, filters: ["Articles and reviews", "English"] },
    { name: "tablet OR software AND literacy AND primary school", detail: "Searched last week", total: 75, questions: ["Is the intervention delivered with digital technology?"] },
    { name: "EdTech numeracy sub-Saharan Africa", detail: "Searched 2 weeks ago", total: 38 },
    { name: "mother tongue instruction AND reading fluency", detail: "Searched 2 weeks ago", total: 164 },
    { name: "teacher coaching AND classroom practice", detail: "Searched 3 weeks ago", total: 251, filters: ["2018 to 2026", "Open access"] },
    { name: "cash transfer AND girls AND secondary school", detail: "Searched last month", total: 240 },
    { name: "home visiting AND early childhood development", detail: "Searched last month", total: 380 },
    { name: "radio instruction AND primary education", detail: "Searched last month", total: 52 },
    { name: "TVET AND youth employment AND Africa", detail: "Searched 2 months ago", total: 412 },
    { name: "remedial education AND randomised", detail: "Searched 2 months ago", total: 133 },
  ],
  collection: [
    { name: "Foundational learning, core set", detail: "64 papers", total: 64 },
    { name: "To read: numeracy", detail: "23 papers", total: 23 },
    { name: "Skills and work, shared reading", detail: "148 papers", total: 148 },
    { name: "Climate and schooling", detail: "188 papers", total: 188 },
    { name: "Girls' education, 2020 onwards", detail: "71 papers", total: 71 },
    { name: "Methods: cluster trials", detail: "12 papers", total: 12 },
    { name: "Empty for now", detail: "No papers yet", total: 0 },
  ],
  saved: [{ name: "All saved papers", detail: "This workspace's library", total: 412 }],
  screening: [
    { name: "Included in TVET and youth employment", detail: "Finished screening", total: 61 },
    { name: "Included in Climate adaptation in schools", detail: "Finished screening", total: 29 },
    { name: "Included in Early childhood development and home visits", detail: "Finished screening", total: 74 },
  ],
  evidenceLibrary: [
    { name: "EdTech Hub Evidence Community", detail: "Whole community", total: 1280 },
    { name: "EdTech Hub: Sub-Saharan Africa", detail: "A collection in EdTech Hub", total: 342 },
    { name: "African Education Research Database", detail: "Whole community", total: 2140 },
  ],
  zotero: [
    { name: "My library", detail: "Your Zotero account", total: 934 },
    { name: "Literacy review 2026", detail: "Group collection", total: 154 },
    { name: "CCT review 2026", detail: "Group collection", total: 96 },
  ],
};

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
export const WRITTEN = ["Is the study published in 2010 or later?", "Is the full text available in English or French?", "Does the study report a comparison group?"];

/** File endings the upload reads as references, and as full texts. */
export const REFERENCE_FILES = /\.(ris|bib|enw|nbib|xml|ciw|csv|txt)$/i;
export const PDF_FILES = /\.pdf$/i;
