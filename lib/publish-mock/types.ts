// MOCK (mock/publish-reports): the shapes the Publish mock keeps in its local store. Nothing here is a
// Convex table yet; the real build moves them there.

import type { Effort } from "@/lib/ai/core/call-options";
import type { PublicationSettings } from "@/convex/evidenceLibraries/publicationValidators";
import { JEV_MODEL } from "@/lib/ai/decisions";

/** A model a check or the metadata reader runs on, as the model picker gives it, with the effort it runs at. */
export type LlmModel = { id: string; name: string; inputPricePerMillion: number; outputPricePerMillion: number; effort?: Effort; reasoningEfforts?: Effort[] };
/** GPT-6 Luna at medium: read 30 of our communities' reports as well as Opus 5.5 and GPT-6.1 Sol, at a fiftieth of Opus's cost (2026-11-09). */
export const DEFAULT_LLM: LlmModel = { id: "openai/gpt-6-luna", name: "GPT-6 Luna", inputPricePerMillion: 0.1, outputPricePerMillion: 0.5, effort: "medium", reasoningEfforts: ["low", "medium", "high"] };
/** TypeSafe's Jev: a decision model, answering yes or no with how sure it is, as screening uses it. */
export const JEV: LlmModel = { id: JEV_MODEL, name: "Jev 1.13", inputPricePerMillion: 0.042, outputPricePerMillion: 0 };

/**
 * A check is a yes-or-no question about the report, answered by a model: a decision model like Jev, or an LLM, which
 * also says why. Yes passes, when the model is at least `threshold` sure of it. The one built-in check, Already
 * published, searches instead of asking, and uses its model to compare what it finds with the report.
 */
export type Check = {
  id: string;
  name: string;
  /** Asked about the report's details and its PDF's text. `{byline}` and `{doi}` are this report's. */
  question: string;
  /** What the author is told to do when the check fails, with `{byline}` and `{doi}` filled in as in the question. */
  fix?: string;
  model: LlmModel;
  /** How sure of yes the model must be, 0 to 1. */
  threshold: number;
  /** A failed blocking check stops the report; another only sends it to review. */
  blocking: boolean;
  enabled: boolean;
  builtIn?: "already-published";
};

export type Answer = "yes" | "no" | "unclear";

/** A check's answer. `confidence` is how sure the model is of yes; Already published has none, only what it found. */
export type CheckResult = {
  checkId: string;
  name: string;
  /** The model that answered, by name. */
  model: string;
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

export type Settings = {
  enabled: boolean;
  humanReview: boolean;
  series: { name: string; issn: string; byline: string };
  /** The Zenodo and Crossref accounts reports register with: the settings a community has, kept the same way. */
  publication: PublicationSettings;
  publicationSavedAt: number | null;
  /** How many reports one person may start in a day, and who may start more or fewer. */
  limits: { perDay: number; overrides: LimitOverride[] };
  metadataModel: LlmModel;
  checks: Check[];
  checksVersion: number;
  agreement: { version: number; updatedAt: number; source: string; text: string };
};

/** A person's or an organisation's own daily limit, by their Clerk ID, with the name an admin knows them by. */
export type LimitOverride = { kind: "person" | "organization"; id: string; name: string; perDay: number };
/** The reports a person may start in a day: their own limit, else their organisation's, else everyone's. */
export function limitFor(settings: Settings, userId: string, orgId: string | null | undefined) {
  const { perDay, overrides } = settings.limits;
  return (overrides.find((o) => o.kind === "person" && o.id === userId) ?? overrides.find((o) => o.kind === "organization" && o.id === orgId))?.perDay ?? perDay;
}
const DAY_MS = 24 * 60 * 60 * 1000;
/** How many more reports this person may start now, counting the ones they started in the last 24 hours. */
export function startsLeft(state: MockState, userId: string, orgId: string | null | undefined) {
  const started = (state.started?.[userId] ?? []).filter((at) => Date.now() - at < DAY_MS).length;
  return Math.max(0, limitFor(state.settings, userId, orgId) - started);
}

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
/** What is saved: a report that passed its checks stays passed until its author activates it. */
/** `declined` is also a live report a reviewer withdrew: `withdrawnAt` tells that one from a report never published. */
export type Status = "draft" | "failed" | "passed" | "live" | "declined";
/** Where a report stands now. A passed report waits for a reviewer while review is on or a check flagged it, and
 * until someone approves it; then it's ready for its author to activate. Worked out from the settings as they are,
 * so switching review off releases the reports waiting only for it. */
export type Stage = "draft" | "failed" | "review" | "ready" | "live" | "declined";
export function stageOf(s: Submission, settings: Settings): Stage {
  // A reviewer may approve a report whatever its checks said: it is then its author's to activate.
  if (s.status === "failed") return s.approved ? "ready" : "failed";
  if (s.status !== "passed") return s.status;
  const needsReview = settings.humanReview || (s.results ?? []).some((r) => !r.pass);
  return s.approved || !needsReview ? "ready" : "review";
}
export type Deposit = "none" | "queued" | "deposited" | "failed";
/** The report's file on Zenodo: a draft from the moment its DOI is reserved, archived once the report is live. */
export type Archive = "none" | "draft" | "queued" | "archived" | "failed";
/** How a report registers, fixed when its DOI is reserved, as a community's record is once it's sent to Zenodo:
 * with Crossref alone, with Zenodo alone under the DOI Zenodo reserves, or with both, the file archived on Zenodo
 * under the Crossref DOI or under one of Zenodo's. Unlike a community, Crossref doesn't need Zenodo here. */
export type Registration = { crossref: boolean; zenodo?: boolean; policy: PublicationSettings["zenodo"]["defaultIdentifierPolicy"] };
export type Provider = "zenodo" | "crossref";
export type RegistrationStep = { provider: Provider; state: "waiting" | "working" | "done" | "failed" };

export type Submission = {
  /** The report's key, which its paper page is named by. */
  id: string;
  /** Who is publishing it, by their Clerk user. */
  ownerId?: string;
  /** MOCK: a sample report every viewer sees as their own, so Your reports has something in it. */
  demo?: boolean;
  doi: string;
  step: Step;
  status: Status;
  /** A reviewer approved it, so its author can activate it whatever the settings say. */
  approved?: boolean;
  /** The author asked a person to look at a report its checks failed, with what they think the checks got wrong.
   * Asking changes nothing about the report: it tells the team's inbox, and the words show to a reviewer. */
  reviewRequest?: { comment: string; at: number };
  signedBy?: { name: string; email: string; onBehalfOfAll: boolean };
  signedAt?: number;
  agreementVersion?: number;
  checksVersion?: number;
  /** The run of the checks under way, so only that run's answers are saved: a new PDF clears it. */
  run?: string;
  /** `at` is when it was uploaded, which tells one upload's reading from the next one's. */
  pdf?: { name: string; pages: number; bytes: number; at?: number };
  /** When the picture of the PDF's first page was made; none until it's ready, or when the page couldn't be drawn. */
  cover?: number;
  metadata?: Metadata;
  results?: CheckResult[];
  deposit: Deposit;
  archive: Archive;
  registration?: Registration;
  activatedAt?: number;
  /** Every reviewer's word on it, oldest first. */
  reviews?: Review[];
  /** When a reviewer withdrew it after it had gone live. Its address then shows a page saying so, and it can be reinstated. */
  withdrawnAt?: number;
  /** MOCK: the communities it was added to from its live page. The real build keeps these as Openscholar's submissions. */
  communities?: Array<{ id: string; name: string; status: "queued" | "published" }>;
  note?: string;
  createdAt: number;
  updatedAt: number;
};

/** The longest comment an author sends with a review request, and the longest note a reviewer sends back: the contact form's limit. */
export const REVIEW_TEXT_MAX = 3000;
/** An email to the team's inbox. MOCK: kept here to be read; the real build sends it (convex/lib/invitationDelivery.ts). */
export type Email = { id: string; at: number; audience: "team" | "author"; to: string; replyTo: string; subject: string; text: string; html: string; report: string; event: string };
/** A reviewer's word on a report: who gave it and when. */
export type Review = { decision: "approve" | "decline" | "withdraw" | "reinstate"; by: string; at: number; note?: string };
/** `drafts` is the report each person has open on the Publish page, by their Clerk user: one person's never shows for another. */
export type MockState = { settings: Settings; submissions: Submission[]; drafts: Record<string, string>; started?: Record<string, number[]>; outbox?: Email[]; checkVersions: Record<string, Check[]>; agreementVersions?: Record<string, string> };

/** Where a report's cover is served from. Its address changes with the picture, so it can be cached for good. */
export const coverUrlOf = (report: Pick<Submission, "id" | "cover">) => (report.cover ? `/publish/files/${report.id}/cover?v=${report.cover}` : null);
/** A report needs a DOI, so publishing needs Crossref or Zenodo connected. */
export const canRegister = (settings: Settings) => settings.publication.zenodo.mode !== "off" || settings.publication.crossref.mode !== "off";
export const canPublish = (settings: Settings) => settings.enabled && canRegister(settings);
export const registrationOf = (settings: Settings): Registration => ({
  crossref: settings.publication.crossref.mode !== "off",
  zenodo: settings.publication.zenodo.mode !== "off",
  policy: settings.publication.zenodo.defaultIdentifierPolicy,
});
/** MOCK: the DOI Zenodo reserves for a report's draft. The real one comes back from Zenodo when the draft is made. */
export const zenodoDoiOf = (settings: Settings, key: string) =>
  `${settings.publication.zenodo.mode === "custom" ? "10.5281" : "10.5072"}/zenodo.${400_000 + (Number(key.slice(1)) % 100_000)}`;
/** The DOI a report gets: under the Crossref prefix and namespace when Crossref is on, else the one Zenodo reserves. */
export const doiOf = (settings: Settings, key: string) => {
  const { crossref } = settings.publication;
  return crossref.mode === "off" ? zenodoDoiOf(settings, key) : `${crossref.prefix}/${crossref.suffixNamespace}.${key.toLowerCase()}`;
};
/** The order a live report registers in. Reusing the Crossref DOI, Zenodo archives once Crossref has it, as in a
 * community; with a DOI of its own, Zenodo goes first and Crossref's record links to the archive. */
export function providersOf(s: Pick<Submission, "registration">): Provider[] {
  const r = s.registration ?? { crossref: true, policy: "reuse-crossref" };
  if (!r.crossref) return ["zenodo"];
  if (r.zenodo === false) return ["crossref"];
  return r.policy === "reuse-crossref" ? ["crossref", "zenodo"] : ["zenodo", "crossref"];
}
/** Each registration of a live report and where it stands; one waits while the one before it isn't done. */
export function stepsOf(s: Submission): RegistrationStep[] {
  let before = true;
  return providersOf(s).map((provider) => {
    const at = provider === "crossref" ? s.deposit : s.archive;
    const done = at === "deposited" || at === "archived";
    const state = done ? "done" : at === "failed" ? "failed" : before ? "working" : "waiting";
    before &&= done;
    return { provider, state };
  });
}
/** The byline a report's PDF must carry, with its DOI and the series' ISSN filled in. */
export const bylineOf = (settings: Settings, doi: string) =>
  settings.series.byline.replace("{doi}", `https://doi.org/${doi}`).replace("{issn}", settings.series.issn || "pending").replace("{series}", settings.series.name);

const STRINGS = ["title", "subtitle", "type", "language", "date", "licence", "abstract"] as const;
const LISTS = ["authors", "topics", "keywords", "sdgs", "studyDesigns", "countries", "funding", "references", "relations"] as const;
/** The details as the details step sends them: the fields every reader of a report relies on, with their types. */
export function isMetadata(value: unknown): value is Metadata {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return STRINGS.every((k) => typeof m[k] === "string") && LISTS.every((k) => Array.isArray(m[k])) && (m.title as string).trim() !== "";
}
