// A report in Openscholar Reports (plans/publish-reports): the steps it goes through, where it stands, and the rules
// its pages and its Convex functions share. Nothing here reads a database or the clock.

export type Answer = "yes" | "no" | "unclear";

/** A check's answer. `confidence` is how sure the model is of yes; Already published has none, only what it found. */
export type CheckResult = {
  checkId: string;
  name: string;
  pass: boolean;
  blocking: boolean;
  answer?: Answer;
  confidence?: number;
  threshold?: number;
  /** An LLM's reason for its answer, or the judge's for a match. */
  reasoning?: string;
  /** What a search found or didn't. */
  detail?: string;
  evidence?: { title: string; url: string; where?: string };
  /** What the author can do about a check that failed, as its admin wrote it. */
  fix?: string;
  /** The check couldn't answer at all, so the report was held for a person. */
  errored?: boolean;
};

/** An institution an author was at for this work: OpenAlex's where it has it (I…), with its country. */
export type Affiliation = { id: string | null; name: string; country: string };
/** CRediT's 14 contributor roles (credit.niso.org). */
export const CREDIT_ROLES = [
  "Conceptualization", "Data curation", "Formal analysis", "Funding acquisition", "Investigation", "Methodology", "Project administration",
  "Resources", "Software", "Supervision", "Validation", "Visualization", "Writing, original draft", "Writing, review and editing",
] as const;
export type Author = { name: string; orcid: string; openalexId: string | null; affiliations: Affiliation[]; corresponding: boolean; roles: string[] };
/** An OpenAlex topic from our catalog (T…, or a subfield or field), with how sure the reader was. */
export type Topic = { id: string; name: string; score: number };
export type Funding = { funder: { id: string | null; name: string }; awards: string[] };
export const RELATION_KINDS = [
  { id: "data", name: "Data" },
  { id: "code", name: "Code" },
  { id: "version", name: "Other version" },
  { id: "supplement", name: "Supplement" },
] as const;
export type RelationKind = (typeof RELATION_KINDS)[number]["id"];
export type Relation = { kind: RelationKind; target: string };

export type Metadata = {
  title: string;
  subtitle: string;
  /** An OpenAlex work type, report unless the author says otherwise. */
  type: string;
  /** ISO 639-1, as OpenAlex keeps it. */
  language: string;
  date: string;
  licence: "CC BY 4.0";
  authors: Author[];
  abstract: string;
  topics: Topic[];
  keywords: string[];
  /** Goal numbers, "1" to "17". */
  sdgs: string[];
  studyDesigns: string[];
  /** Where the work is about, ISO 3166 codes: not where its authors are. */
  countries: string[];
  funding: Funding[];
  /** DOIs the work cites. */
  references: string[];
  relations: Relation[];
};

/** The most of each list a report's details hold, and the longest they are altogether, as their JSON. */
export const DETAIL_CAPS = { authors: 200, affiliations: 10, roles: CREDIT_ROLES.length, topics: 20, keywords: 50, sdgs: 17, studyDesigns: 20, countries: 300, funding: 50, awards: 20, references: 1000, relations: 50 } as const;
export const DETAILS_MAX_BYTES = 300_000;
/** The longest each of a report's texts is, which its box shows as it's typed. */
export const DETAIL_TEXT = { title: 500, subtitle: 500, abstract: 10_000, name: 200, keyword: 100, link: 500 } as const;

/** An ORCID iD with its check digit right (ISO 7064 11-2), as 0000-0002-1825-0097. */
export function isOrcid(id: string) {
  if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(id)) return false;
  const digits = id.replace(/-/g, "");
  const total = [...digits.slice(0, 15)].reduce((sum, digit) => (sum + Number(digit)) * 2, 0);
  const check = (12 - (total % 11)) % 11;
  return (check === 10 ? "X" : String(check)) === digits[15];
}
/** A DOI as a reference keeps it, lower case and without its address; null for text that isn't one. */
export const doiIn = (text: string) => text.trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "").replace(/^doi:\s*/, "").match(/^10\.\d{4,9}\/\S+$/)?.[0] ?? null;
/** The longest comment an author sends with a review request, and the longest note a reviewer sends back: the contact form's limit. */
export const REVIEW_TEXT_MAX = 3000;
export const SIGNER_NAME_MAX = 200;
export const FILE_NAME_MAX = 200;

export const STEPS = ["doi", "upload", "details", "done"] as const;
/** Where a report is in being made: its DOI just reserved, its PDF going up or being read, its details open, or checked. */
export type Step = (typeof STEPS)[number];
export const STATUSES = ["draft", "failed", "passed", "live", "declined"] as const;
/** What is saved: a report that passed its checks stays passed until its author activates it. `declined` is also a
 * live report a reviewer withdrew: `withdrawnAt` tells that one from a report never published. */
export type Status = (typeof STATUSES)[number];
export const STAGES = ["draft", "review", "ready", "live", "failed", "declined"] as const;
/** Where a report stands now. A passed report waits for a reviewer while review is on or a check flagged it, and
 * until someone approves it; then it's ready for its author to activate. Worked out from the settings as they are,
 * so switching review off releases the reports waiting only for it. */
export type Stage = (typeof STAGES)[number];
/** What a report's standing is told from: `flagged` is that one of its checks didn't pass. */
export type Standing = { step: Step; status: Status; approved?: boolean; flagged?: boolean };
export function stageOf(report: Standing, humanReview: boolean): Stage {
  // Sent back for a new PDF, a report is being worked on again: nothing about its last checks is waiting on anyone.
  if (report.step !== "done") return "draft";
  // A reviewer may approve a report whatever its checks said: it is then its author's to activate.
  if (report.status === "failed") return report.approved ? "ready" : "failed";
  if (report.status !== "passed") return report.status;
  return report.approved || !(humanReview || report.flagged) ? "ready" : "review";
}

/** Where a live report's waiting changes stand: a check they newly fail holds them for the author to fix or ask
 * about, anything else waits for a reviewer. */
export const CHANGE_STAGES = ["failed", "review", "declined"] as const;
export type ChangeStage = (typeof CHANGE_STAGES)[number];
export function changeStageOf(results: CheckResult[] | undefined, changes: { results: CheckResult[]; requested?: boolean; declined?: boolean }): ChangeStage {
  if (changes.declined) return "declined";
  // A check the report itself failed was a reviewer's to overrule, and is again.
  const overruled = new Set((results ?? []).filter((r) => !r.pass).map((r) => r.checkId));
  return !changes.requested && changes.results.some((r) => !r.pass && r.blocking && !overruled.has(r.checkId)) ? "failed" : "review";
}

/** A report its author may give up: one never checked, or one its checks failed that no reviewer approved. Its DOI was never live. */
export const canDiscard = (report: Pick<Standing, "status" | "approved">) => report.status === "draft" || (report.status === "failed" && !report.approved);
/** The reports a workspace is in the middle of: neither live nor declined. */
export const underWay = (report: Pick<Standing, "status">) => report.status !== "live" && report.status !== "declined";
/** Whether a report wants a reviewer now: waiting for review, failed with its author asking, or live with changes waiting. */
export const wantsReviewer = (report: Standing & { asked?: boolean; changes?: ChangeStage }, humanReview: boolean) => {
  const stage = stageOf(report, humanReview);
  return stage === "review" || (stage === "failed" && !!report.asked) || (stage === "live" && report.changes === "review");
};

export type Deposit = "none" | "queued" | "deposited" | "failed";
/** The report's file on Zenodo: a draft from the moment its DOI is reserved, archived once the report is live. */
export type Archive = "none" | "draft" | "queued" | "archived" | "failed";
/** How a report registers, fixed when its DOI is reserved, as a community's record is once it's sent to Zenodo:
 * with Crossref alone, with Zenodo alone under the DOI Zenodo reserves, or with both, the file archived on Zenodo
 * under the Crossref DOI or under one of Zenodo's. */
export type Registration = { crossref: boolean; zenodo: boolean; policy: "mint-zenodo" | "reuse-crossref" };
export type Provider = "zenodo" | "crossref";
export type RegistrationStep = { provider: Provider; state: "waiting" | "working" | "done" | "failed" };
/** The order a live report registers in. Reusing the Crossref DOI, Zenodo archives once Crossref has it, as in a
 * community; with a DOI of its own, Zenodo goes first and Crossref's record links to the archive. */
export function providersOf(r: Registration): Provider[] {
  if (!r.crossref) return ["zenodo"];
  if (!r.zenodo) return ["crossref"];
  return r.policy === "reuse-crossref" ? ["crossref", "zenodo"] : ["zenodo", "crossref"];
}
/** Each registration of a live report and where it stands; one waits while the one before it isn't done. */
export function stepsOf(report: { registration: Registration; deposit: Deposit; archive: Archive }): RegistrationStep[] {
  let before = true;
  return providersOf(report.registration).map((provider) => {
    const at = provider === "crossref" ? report.deposit : report.archive;
    const done = at === "deposited" || at === "archived";
    const state = done ? "done" : at === "failed" ? "failed" : before ? "working" : "waiting";
    before &&= done;
    return { provider, state };
  });
}

const FIELD_TEXT: Array<[label: string, text: (m: Metadata) => string]> = [
  ["Title", (m) => m.title],
  ["Subtitle", (m) => m.subtitle],
  ["Type", (m) => m.type],
  ["Language", (m) => m.language],
  ["Date", (m) => m.date],
  ["Authors", (m) => m.authors.map((a) => [a.name, a.orcid, a.affiliations.map((x) => x.name).join("; "), a.roles.join(", "), a.corresponding ? "corresponding" : ""].filter(Boolean).join(", ")).join("\n")],
  ["Abstract", (m) => m.abstract],
  ["Topics", (m) => m.topics.map((t) => t.name).join(", ")],
  ["Keywords", (m) => m.keywords.join(", ")],
  ["Goals", (m) => m.sdgs.join(", ")],
  ["Study designs", (m) => m.studyDesigns.join(", ")],
  ["Places", (m) => m.countries.join(", ")],
  ["Funding", (m) => m.funding.map((f) => [f.funder.name, ...f.awards].join(", ")).join("\n")],
  ["References", (m) => m.references.join("\n")],
  ["Links", (m) => m.relations.map((r) => `${r.kind}: ${r.target}`).join("\n")],
];
/** What a correction changes, field by field, as text: what it was and what it would be. */
export function changesOf(before: Metadata, after: Metadata) {
  return FIELD_TEXT.flatMap(([label, text]) => (text(before) === text(after) ? [] : [{ label, from: text(before), to: text(after) }]));
}

/** A report's key: R and six digits. */
export const keyOf = (n: number) => `R${String(100_000 + n).padStart(6, "0")}`;
export const isReportKey = (id: string) => /^R\d{6,}$/.test(id);
/** The details a PDF's reading couldn't give: its file's name as the title, for its author to fill in. */
export const blankDetails = (fileName: string, today: string): Metadata => ({
  title: fileName.replace(/\.pdf$/i, "").replace(/[-_]+/g, " "), subtitle: "", type: "report", language: "en", date: today, licence: "CC BY 4.0",
  authors: [], abstract: "", topics: [], keywords: [], sdgs: [], studyDesigns: [], countries: [], funding: [], references: [], relations: [],
});
