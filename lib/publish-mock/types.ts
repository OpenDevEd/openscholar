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
  /** How many reports a workspace may start in a day: a person's own by default, an organisation's by default
   * (none until it's opened, since anyone can make an organisation), and the ones given a number of their own. */
  limits: { perDay: number; orgPerDay?: number; overrides: LimitOverride[] };
  metadataModel: LlmModel;
  checks: Check[];
  checksVersion: number;
  agreement: { version: number; updatedAt: number; source: string; text: string };
};

/** A person or an organisation as Clerk has them: who they are in a list, with their photo or logo. */
export type Account = { kind: "person" | "organization"; id: string; name: string; detail: string; imageUrl: string | null };
/** A person's or an organisation's own daily limit, by their Clerk ID. Their name is kept for the admin's list when
 * Clerk can't be asked; their email and photo are never kept here, and are read from Clerk for an admin only. */
export type LimitOverride = Pick<Account, "kind" | "id" | "name"> & { perDay: number };
/** The settings as an author's page may have them: what its screens show, and nothing of who has a limit of their
 * own, the registrars' accounts, or what each check asks and how sure it must be. */
export const authorSettings = (settings: Settings): Settings => ({
  ...settings,
  limits: { perDay: settings.limits.perDay, orgPerDay: settings.limits.orgPerDay, overrides: [] },
  publication: { zenodo: settings.publication.zenodo, crossref: { ...settings.publication.crossref, depositorName: "", email: "", registrant: "" } },
  metadataModel: { ...settings.metadataModel, id: "", name: "" },
  checks: settings.checks.map((c) => ({ ...c, question: "", fix: undefined, threshold: 0, model: { ...c.model, id: "", name: "" } })),
});
/** The workspace a report starts in: a person's own, by their Clerk user, or an organisation's, by its Clerk ID. */
export type Workspace = { kind: LimitOverride["kind"]; id: string };
/** The reports a workspace may start in a day: the number it was given, else the one for its kind. A person's
 * number is their own workspace's and nothing to do with the organisations they are in. */
export function limitFor(settings: Settings, workspace: Workspace) {
  const { perDay, orgPerDay = 0, overrides } = settings.limits;
  return overrides.find((o) => o.kind === workspace.kind && o.id === workspace.id)?.perDay ?? (workspace.kind === "person" ? perDay : orgPerDay);
}
/** What a workspace that has used up its day's reports, or has none, is told. */
export const limitWords = (perDay: number, kind: Workspace["kind"]) =>
  kind === "person"
    ? perDay === 0
      ? "Publishing isn't open to your account yet."
      : `You can start ${perDay} ${perDay === 1 ? "report" : "reports"} a day. Come back tomorrow.`
    : perDay === 0
      ? "Publishing isn't open to this workspace yet. You can publish from your own."
      : `This workspace can start ${perDay} ${perDay === 1 ? "report" : "reports"} a day. Come back tomorrow.`;
const DAY_MS = 24 * 60 * 60 * 1000;
/** How many more reports a workspace may start now: its limit as it is now, less the ones started in it in the last
 * 24 hours. So a limit raised today opens that many more today. */
export function startsLeft(state: MockState, workspace: Workspace) {
  const started = (state.started?.[workspace.id] ?? []).filter((at) => Date.now() - at < DAY_MS).length;
  return Math.max(0, limitFor(state.settings, workspace) - started);
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
  // Sent back for a new PDF, a report is being worked on again: nothing about its last checks is waiting on anyone.
  if (s.step !== "done") return "draft";
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
  /** Who started it, by their Clerk user. */
  ownerId?: string;
  /** The organisation whose workspace it was started in, by its Clerk ID, with its name then: the report is that
   * workspace's, and every member's to work on. None for one started in a person's own workspace, which is theirs alone. */
  orgId?: string;
  orgName?: string;
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
  /** When its author last corrected its details after it went live. */
  correctedAt?: number;
  /** Changes its author made to a live report's details that haven't gone live: the report stays as it was meanwhile. */
  correction?: Correction;
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

/**
 * A report as its author's page is sent it: what its screens show. Left out are the address on its signature, the
 * model behind each check's answer, who reviewed it, and the run under way.
 */
export function forAuthor(s: Submission): Submission {
  const plain = (results: CheckResult[] | undefined) => results?.map((r) => ({ ...r, model: "" }));
  return {
    ...s,
    run: undefined,
    reviews: undefined,
    signedBy: s.signedBy && { ...s.signedBy, email: "" },
    results: plain(s.results),
    correction: s.correction && { ...s.correction, results: plain(s.correction.results) ?? [] },
  };
}
/** What an action answers when it can't do what was asked: the reason, in words for the person. */
export type Refused = { refused: string };
/** The longest comment an author sends with a review request, and the longest note a reviewer sends back: the contact form's limit. */
export const REVIEW_TEXT_MAX = 3000;
/** An email to the team's inbox. MOCK: kept here to be read; the real build sends it (convex/lib/invitationDelivery.ts). */
export type Email = { id: string; at: number; audience: "team" | "author"; to: string; replyTo: string; subject: string; text: string; html: string; report: string; event: string };
/** A reviewer's word on a report, or on changes to a live one: who gave it and when. */
export type Review = { decision: "approve" | "decline" | "withdraw" | "reinstate" | "approve-changes" | "decline-changes" | "edit"; by: string; at: number; note?: string };
export type MockState = { settings: Settings; submissions: Submission[]; started?: Record<string, number[]>; outbox?: Email[]; checkVersions: Record<string, Check[]>; agreementVersions?: Record<string, string> };

/**
 * Changes to a live report's details, checked like the report was. They go live at once when every check passes and
 * review is off. Otherwise they are kept here until a reviewer approves them, so a report a reviewer approved over a
 * check's answer needs a reviewer again when it changes. `at` is when they were checked, which tells one set of
 * changes from the next.
 */
export type Correction = {
  metadata: Metadata;
  results: CheckResult[];
  checksVersion: number;
  at: number;
  /** The author asked a person to look at changes a check refused. */
  request?: { comment: string; at: number };
  /** A reviewer said no. The changes are kept for the author to change again or discard. */
  declined?: { at: number; note?: string };
};
/** Where a live report's waiting changes stand: a check they newly fail holds them for the author to fix or ask
 * about, anything else waits for a reviewer. */
export type CorrectionStage = "failed" | "review" | "declined";
export function correctionStageOf(s: Pick<Submission, "results">, c: Correction): CorrectionStage {
  if (c.declined) return "declined";
  // A check the report itself failed was a reviewer's to overrule, and is again.
  const overruled = new Set((s.results ?? []).filter((r) => !r.pass).map((r) => r.checkId));
  return !c.request && c.results.some((r) => !r.pass && r.blocking && !overruled.has(r.checkId)) ? "failed" : "review";
}
/** The reports a workspace is in the middle of: neither live nor declined. */
export const reportsUnderWay = (reports: Submission[]) => reports.filter((r) => r.status !== "live" && r.status !== "declined");
/** Whether a report is this workspace's: an organisation's, or with none the person's own. */
export const inWorkspace = (r: Submission, userId: string, orgId: string | undefined) => (orgId ? r.orgId === orgId : !r.orgId && r.ownerId === userId);
/** Whether a person sees a report: it is their own, or an organisation's they are a member of. */
export const mayWorkOn = (r: Submission, userId: string, orgIds: readonly string[]) => (r.orgId ? orgIds.includes(r.orgId) : r.ownerId === userId);
/**
 * Whether a person may change a report: upload, correct, activate, discard. Its owner, who started it, and in an
 * organisation's workspace that workspace's admins. Its other members see it and no more. The real build adds
 * anyone the report is shared with as an editor, through the sharing every other item in a workspace has.
 */
export const mayChange = (r: Submission, userId: string, adminOf: readonly string[]) => r.ownerId === userId || (!!r.orgId && adminOf.includes(r.orgId));
/** A report its author may give up: one never checked, or one its checks failed that no reviewer approved. Its DOI was never live. */
export const canDiscard = (r: Submission) => r.status === "draft" || (r.status === "failed" && !r.approved);
/** Whether a report wants a reviewer now: waiting for review, failed with its author asking, or live with changes waiting. */
export function wantsReviewer(s: Submission, settings: Settings) {
  const stage = stageOf(s, settings);
  return stage === "review" || (stage === "failed" && !!s.reviewRequest) || (stage === "live" && !!s.correction && correctionStageOf(s, s.correction) === "review");
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

/** Where a report's cover is served from. Its address changes with the picture, so a new PDF's cover is never an old one's. */
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
export function isMetadata(value: unknown, { titled = true } = {}): value is Metadata {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  // A title is needed to run the checks, not to keep what the author has typed so far.
  return STRINGS.every((k) => typeof m[k] === "string") && LISTS.every((k) => Array.isArray(m[k])) && (!titled || (m.title as string).trim() !== "");
}
