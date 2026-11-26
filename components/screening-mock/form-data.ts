// What the screening form offers to pick from, made up: places papers can come from, the
// collections included papers can go to, and the questions a search already asks.

import { NOW, day, includedIn, type Screening, type SourceKind } from "./data";

export type Offer = { name: string; detail: string; total: number; questions?: string[]; /** A search's filters. */ filters?: string[]; /** The kind it is added as, where that is not its tab's: the whole library sits above its collections. */ kind?: SourceKind };

export const OFFERS: Record<Exclude<SourceKind, "upload" | "pdf" | "dois" | "evidenceLibrary" | "saved" | "screening" | "zotero">, Offer[]> = {
  search: [
    { name: "structured pedagogy AND early grade reading", detail: "Searched yesterday", total: 318, filters: ["2010 to 2026", "Articles", "Open access"], questions: ["Does the study report reading outcomes?", "Was the programme delivered by government teachers?"] },
    { name: "teaching at the right level", detail: "Searched 3 days ago", total: 96, filters: ["2015 to 2026"] },
    { name: "school feeding AND learning outcomes", detail: "Searched 16 Nov", total: 207, filters: ["Articles and reviews", "English"] },
    // This search and the next are EdTech's: their totals are what they hold now, after this morning's check found more.
    { name: "tablet OR software AND literacy AND primary school", detail: "Searched 16 Nov", total: 81, questions: ["Is the intervention delivered with digital technology?"] },
    { name: "EdTech numeracy sub-Saharan Africa", detail: "Searched 9 Nov", total: 41 },
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
};

/** A collection in a Zotero library. `papers` are the ones filed in it directly, as Zotero counts them: the ones in its sub-collections are theirs. */
export type ZoteroCollection = { key: string; name: string; papers: number; parent?: string };
/** A library the connected Zotero account can read: the person's own, or a group's. `papers` is every paper in it, filed or not. */
export type ZoteroLibrary = { id: string; name: string; group: boolean; papers: number; /** Papers filed in no collection: only the whole library holds them. */ loose: number; /** How many in a hundred of its papers carry an abstract. */ abstracts: number; collections: ZoteroCollection[] };
type Nest = [name: string, papers: number, inside?: Nest[]];
const filed = (library: string, nests: Nest[], parent?: string): ZoteroCollection[] =>
  nests.flatMap(([name, papers, inside], at) => { const key = `${parent ?? library}.${at}`; return [{ key, name, papers, ...(parent ? { parent } : {}) }, ...filed(library, inside ?? [], key)]; });
const library = (id: string, name: string, papers: number, loose: number, abstracts: number, nests: Nest[], group = true): ZoteroLibrary => ({ id, name, group, papers, loose, abstracts, collections: filed(id, nests) });
const countries = (...list: Array<[string, number]>): Nest[] => list.map(([name, papers]) => [name, papers]);

// Made up, in the shapes real accounts have: a dozen groups, one with tens of collections three levels down, a review whose
// searches were filed by database and date, and a dump of 172,728 records in one collection.
export const ZOTERO: ZoteroLibrary[] = [
  library("mine", "My library", 934, 234, 78, [
    ["Thesis", 0, [["Chapter 2, literature review", 88, [["To cite", 31], ["Read and set aside", 54]]], ["Chapter 4, methods", 47], ["Chapter 5, discussion", 26]]],
    ["Unsorted imports", 310],
    ["Reading group", 64],
    ["Grant proposal 2027", 39],
    ["Teaching", 12, [["Week 3, randomised trials", 12], ["Week 7, systematic reviews", 17]]],
    ["Empty for now", 0],
  ], false),
  library("lit", "Literacy review 2026", 154, 0, 91, [
    ["Database searches", 0, [["ERIC, 12 March", 48], ["Scopus, 12 March", 52], ["Web of Science, 12 March", 37]]],
    ["Included at full text", 22],
    ["Background reading", 17],
  ]),
  library("cct", "CCT review 2026", 96, 0, 95, [
    ["Search results", 0, [["PubMed", 41], ["EconLit", 33], ["3ie portal", 22]]],
    ["Included", 18],
  ]),
  library("hub", "Education evidence, shared library", 11122, 1890, 51, [
    ["Regions", 0, [
      ["Sub-Saharan Africa", 212, countries(["Kenya", 318], ["Nigeria", 188], ["Ghana", 241], ["Tanzania", 204], ["Sierra Leone", 166], ["Malawi", 143], ["Uganda", 131], ["Rwanda", 127], ["Ethiopia", 97], ["Zambia", 64])],
      ["South Asia", 88, countries(["India", 301], ["Pakistan", 173], ["Bangladesh", 142], ["Nepal", 58])],
      ["Latin America and the Caribbean", 41, countries(["Brazil", 77], ["Mexico", 52], ["Peru", 31])],
      ["Middle East and North Africa", 36, countries(["Jordan", 44], ["Morocco", 38], ["Lebanon", 29])],
    ]],
    ["Topics", 0, [
      ["Foundational learning", 118, countries(["Early grade reading", 205], ["Numeracy", 164], ["Mother-tongue instruction", 73])],
      ["Teachers", 96, countries(["Coaching", 131], ["Pre-service training", 68], ["Teacher allocation", 42])],
      ["Technology", 154, countries(["AI tutors", 109], ["Tablets", 81], ["Radio and audio", 52], ["Messaging", 47])],
      ["Climate and schooling", 188],
      ["Assessment", 143],
      ["Disability and inclusion", 112],
      ["Girls' education", 96],
      ["School feeding", 59],
    ]],
    ["Publication type", 0, countries(["Journal articles", 4318], ["Reports", 2906], ["Working papers", 1204], ["Blog posts and news", 942], ["Books and chapters", 611], ["Theses", 187])],
    ["Methods", 0, countries(["Qualitative studies", 513], ["Randomised trials", 402], ["Quasi-experiments", 288], ["Systematic reviews", 176], ["Cost analyses", 61])],
    ["Programmes", 0, countries(["Teaching at the right level", 96], ["Structured pedagogy pilots", 71], ["Reading for all", 64], ["Accelerated learning", 48], ["School grants", 39], ["Community tutors", 27])],
    ["Imports", 0, countries(["OpenAlex, 3 November", 412], ["Crossref alerts", 96], ["Suggested by readers", 28])],
    ["To check", 37],
    ["Duplicates to merge", 12],
  ]),
  library("tpd", "Teacher development systematic review", 4733, 0, 48, [
    ["Database searches", 0, [
      ["ProQuest Education, 30 July 2020", 0, countries(["Records 1 to 522", 522], ["Records 523 to 998", 476], ["Records 999 to 1,472", 474])],
      ["ERIC, 30 July 2020", 0, countries(["Records 1 to 472", 472], ["Records 473 to 934", 462])],
      ["Scopus, 31 July 2020", 388],
      ["Grey literature", 0, countries(["Donor reports", 141], ["World Bank", 96])],
    ]],
    ["Screening", 0, [
      ["Title and abstract", 0, [["Included", 476], ["Excluded", 0, countries(["Wrong study design", 1040], ["Wrong population", 812], ["Not about teachers", 655])]]],
      ["Full text", 0, countries(["Excluded", 333], ["Included", 143])],
    ]],
    ["Papers to screen again", 5],
  ]),
  library("sdg", "SDG literature, all sources", 172728, 1490, 56, [["All imported records", 171235], ["Checked by hand", 3], ["Goal 4, education", 0], ["Goal 13, climate", 0], ["To sort", 0]]),
  library("climate", "Climate and schooling review", 2242, 310, 70, [["Searches", 0, countries(["Scopus", 844], ["Web of Science", 631], ["ERIC", 297])], ["Included", 160]]),
  library("girls", "Girls' education network", 1881, 402, 66, [["By country", 0, countries(["Kenya", 388], ["Malawi", 274], ["Bangladesh", 251], ["Pakistan", 233])], ["Policy documents", 333]]),
  library("policy", "Policy toolkit", 1118, 96, 39, [["Guidance notes", 412], ["Case studies", 377], ["Evaluations", 233]]),
  library("tvet", "TVET and digital skills", 662, 0, 72, [["Africa", 301], ["Asia", 198], ["Europe", 163]]),
  library("feeding", "School feeding review", 589, 0, 88, [["Search results", 0, countries(["PubMed", 214], ["Scopus", 196], ["AGRIS", 121])], ["Included", 58]]),
  library("numeracy", "Numeracy trial searches", 123, 123, 81, []),
  library("methods", "Methods reading group", 118, 9, 84, [["2026", 61], ["2025", 48]]),
  library("new", "New group", 0, 0, 0, []),
];
/** The collections filed directly in one, or at the top of the library. */
export const zoteroInside = (in_: ZoteroLibrary, key?: string) => in_.collections.filter((one) => one.parent === key);
/** Every collection under one, at any depth. */
export const zoteroUnder = (in_: ZoteroLibrary, key: string): ZoteroCollection[] => zoteroInside(in_, key).flatMap((one) => [one, ...zoteroUnder(in_, one.key)]);
/** A collection's papers with those of every collection under it. */
export const zoteroDeep = (in_: ZoteroLibrary, one: ZoteroCollection) => one.papers + zoteroUnder(in_, one.key).reduce((sum, under) => sum + under.papers, 0);
/** The collections a collection sits in, outermost first. */
export const zoteroPath = (in_: ZoteroLibrary, one: ZoteroCollection): ZoteroCollection[] => { const parent = in_.collections.find((other) => other.key === one.parent); return parent ? [...zoteroPath(in_, parent), parent] : []; };

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

/** Criteria a model writes from a research question, each with the short name it gives it. */
// The mock has no model to write them: these fit any question, one for each part a question has. The product writes them from the question's own words.
export const WRITTEN = [
  { text: "Are the people studied the ones the question asks about?", short: "Population" },
  { text: "Is the place or setting the one the question asks about?", short: "Setting" },
  { text: "Is what was done the intervention the question asks about?", short: "Intervention" },
  { text: "Does the study report an outcome the question asks about?", short: "Outcome" },
  { text: "Does the study compare groups, with a control or a comparison group?", short: "Comparison group" },
];

/** File endings the upload reads as references, and as papers, and the formats as they are named to people. */
const REFERENCE_ENDINGS = ["ris", "bib", "enw", "nbib", "xml", "ciw", "csv", "tsv", "txt"];
/** Tables, whose columns have to be told apart: every other reference file names its own parts. */
export const TABLE_FILES = /\.(csv|tsv)$/i;
export const REFERENCE_FILES = new RegExp(`\\.(${REFERENCE_ENDINGS.join("|")})$`, "i");
export const PDF_FILES = /\.pdf$/i;
export const UPLOAD_ACCEPT = [...REFERENCE_ENDINGS, "pdf"].map((ending) => `.${ending}`).join(",");
export const UPLOAD_FORMATS = "RIS, BibTeX, EndNote, PubMed, Web of Science, CSV and PDF";

/** The settings' own collection on a running screening is kind "new" with no `collection`; a second one started from the settings carries this mark until it is saved. */
export const ANOTHER_COLLECTION = "another";

/** Where a screening's included papers are saved, by name, or null where they stay in it. The pages and the files both read this. */
export function collectionName(screening: Pick<Screening, "destination" | "name">) {
  const to = screening.destination;
  if (to.kind === "none") return null;
  if (to.kind === "new") return to.name || `${includedIn(screening.name)}${to.collection === ANOTHER_COLLECTION ? `, from ${day(NOW)}` : ""}`;
  return [...COLLECTIONS, ...COMMUNITY_COLLECTIONS].find((one) => one.id === to.collection)?.name ?? null;
}
