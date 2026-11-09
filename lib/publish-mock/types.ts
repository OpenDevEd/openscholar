// MOCK (mock/publish-reports): the shapes the Publish mock keeps in its local store. Nothing here is a
// Convex table yet; the real build moves them there.

export type Engine = "decision" | "llm";

/** The decision models a check can run on, which answer without a language model. */
export const DECISION_MODELS = [
  { id: "text-match", name: "Text match", maker: "Openscholar", hint: "Looks for a required text in the PDF" },
  { id: "similarity-check", name: "Similarity Check", maker: "Crossref", hint: "Share of the text found in published work" },
  { id: "omni-moderation", name: "Moderation", maker: "OpenAI", hint: "Hate, harassment, violence and self-harm" },
  { id: "language-id", name: "Language ID", maker: "fastText", hint: "The language the text is written in" },
] as const;
export type DecisionModelId = (typeof DECISION_MODELS)[number]["id"];

/** An LLM a check or the metadata reader runs on, as the model picker gives it. */
export type LlmModel = { id: string; name: string; inputPricePerMillion: number; outputPricePerMillion: number };

export type Check = {
  id: string;
  name: string;
  engine: Engine;
  decisionModel?: DecisionModelId;
  llm?: LlmModel;
  /** What the check looks for: the text to find, or the LLM's instructions. */
  instructions: string;
  /** The score a report needs, 0 to 1; `atMost` for a score that must stay under it, like similarity. */
  threshold: number;
  direction: "atLeast" | "atMost";
  /** A failed blocking check stops the report; an advisory one only flags it for review. */
  blocking: boolean;
  enabled: boolean;
};

/** What every check returns, whichever engine runs it. `reasoning` comes from an LLM only. */
export type CheckResult = { checkId: string; name: string; engine: Engine; pass: boolean; score: number; threshold: number; direction: Check["direction"]; blocking: boolean; reasoning?: string };

export type Settings = {
  enabled: boolean;
  humanReview: boolean;
  series: { name: string; issn: string; prefix: string; suffix: string; byline: string };
  crossref: "sandbox" | "production";
  metadataModel: LlmModel;
  checks: Check[];
  checksVersion: number;
  agreement: { version: number; updatedAt: number; source: string; text: string };
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
export type Relation = { kind: (typeof RELATION_KINDS)[number]["id"]; target: string };

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

export type Step = "agreement" | "doi" | "upload" | "details" | "checks" | "done";
export type Status = "draft" | "failed" | "review" | "live" | "declined";
export type Deposit = "none" | "queued" | "deposited" | "failed";

export type Submission = {
  /** The report's key, which its paper page is named by. */
  id: string;
  doi: string;
  step: Step;
  status: Status;
  signedBy?: { name: string; email: string; onBehalfOfAll: boolean };
  signedAt?: number;
  agreementVersion?: number;
  checksVersion?: number;
  pdf?: { name: string; pages: number; bytes: number };
  metadata?: Metadata;
  results?: CheckResult[];
  deposit: Deposit;
  note?: string;
  createdAt: number;
  updatedAt: number;
};

export type MockState = { settings: Settings; submissions: Submission[]; draftId: string | null; checkVersions: Record<string, Check[]>; agreementVersions?: Record<string, string> };

/** The DOI a report gets: the series' prefix and its suffix, with `{key}` for the report's key. */
export const doiOf = (settings: Settings, key: string) => `${settings.series.prefix}/${settings.series.suffix.replace("{key}", key.toLowerCase())}`;
/** The byline a report's PDF must carry, with its DOI and the series' ISSN filled in. */
export const bylineOf = (settings: Settings, doi: string) =>
  settings.series.byline.replace("{doi}", `https://doi.org/${doi}`).replace("{issn}", settings.series.issn || "pending").replace("{series}", settings.series.name);
