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

export type Author = { name: string; orcid: string; affiliation: string; country: string };
export type Metadata = { title: string; authors: Author[]; abstract: string; keywords: string[]; language: string; date: string; licence: "CC BY 4.0" };

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

export type MockState = { settings: Settings; submissions: Submission[]; draftId: string | null; checkVersions: Record<string, Check[]> };

/** The DOI a report gets: the series' prefix and its suffix, with `{key}` for the report's key. */
export const doiOf = (settings: Settings, key: string) => `${settings.series.prefix}/${settings.series.suffix.replace("{key}", key.toLowerCase())}`;
/** The byline a report's PDF must carry, with its DOI and the series' ISSN filled in. */
export const bylineOf = (settings: Settings, doi: string) =>
  settings.series.byline.replace("{doi}", `https://doi.org/${doi}`).replace("{issn}", settings.series.issn || "pending").replace("{series}", settings.series.name);
