// Openscholar Reports' settings as Convex keeps them and its pages read them (plans/publish-reports): what the
// series starts with, how a workspace's daily limit is worked out, and the words each rule is told to a person in.
import type { PublicationSettings } from "../../convex/evidenceLibraries/publicationValidators";
import type { Effort } from "../ai/core/call-options";
import { JEV_MODEL } from "../ai/decisions";
import { DEFAULT_AGREEMENT } from "./agreement-text";

/** GPT-6 Luna at medium read 30 of our communities' reports as well as Opus 5.5 and GPT-6.1 Sol, at a fiftieth of Opus's cost (2026-11-09). */
export const DEFAULT_TEXT_MODEL = "openai/gpt-6-luna";
export const DEFAULT_TEXT_EFFORT: Effort = "medium";

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
  /** The model's slug in the catalog, and the effort it runs at. */
  modelId: string;
  effort?: Effort;
  /** How sure of yes the model must be, 0 to 1. */
  threshold: number;
  /** A failed blocking check stops the report; another only sends it to review. */
  blocking: boolean;
  enabled: boolean;
  builtIn?: "already-published";
};

export type Series = { name: string; issn: string; byline: string };

/** The most checks the series holds, the longest of each of their texts, and the longest agreement. */
export const MAX_CHECKS = 20;
export const CHECK_NAME_MAX = 80;
export const CHECK_TEXT_MAX = 1000;
export const SERIES_TEXT_MAX = 200;
export const AGREEMENT_MAX = 100_000;
/** A daily limit is a whole number from 0, which stops a workspace starting any, to 1,000. */
export const MAX_DAILY_LIMIT = 1000;
export const dailyLimit = (n: number) => Math.min(MAX_DAILY_LIMIT, Math.max(0, Math.round(Number.isFinite(n) ? n : 0)));

export const DEFAULT_CHECKS: Check[] = [
  {
    id: "byline",
    name: "Byline and DOI in the PDF",
    question: 'Does the text include this line, allowing for line breaks and spacing: "{byline}"?',
    fix: "Put this line on the cover or the first page, as text and not as a picture, then upload the PDF again: {byline}",
    modelId: JEV_MODEL,
    threshold: 0.8,
    blocking: true,
    enabled: true,
  },
  {
    id: "published",
    name: "Already published",
    question: "Is this report the same work as the record found?",
    fix: "If this is your own earlier publication, say so when you ask for a review.",
    modelId: DEFAULT_TEXT_MODEL,
    effort: DEFAULT_TEXT_EFFORT,
    threshold: 0.5,
    // A match goes to a reviewer: the author may be the one who published it.
    blocking: false,
    enabled: true,
    builtIn: "already-published",
  },
  {
    id: "harm",
    name: "No hate speech or harassment",
    question: "Is the text free of hate speech, harassment and threats against people? Research that studies these as its subject is fine.",
    fix: "Take out the passages that attack people, then upload the PDF again.",
    modelId: JEV_MODEL,
    threshold: 0.7,
    blocking: true,
    enabled: true,
  },
  {
    id: "research",
    name: "Research, not advertising",
    question: "Is this a research output, rather than an advertisement, a sales brochure or a page that mostly links to unrelated sites?",
    fix: "Openscholar Reports publishes research. If yours is, ask for a review and say what the check missed.",
    modelId: DEFAULT_TEXT_MODEL,
    effort: DEFAULT_TEXT_EFFORT,
    threshold: 0.7,
    blocking: false,
    enabled: true,
  },
];

/** Registration off on both sides, which keeps Publish closed until an admin connects one. */
export const NO_PUBLICATION: PublicationSettings = {
  zenodo: { mode: "off", license: "cc-by-4.0", defaultIdentifierPolicy: "reuse-crossref" },
  crossref: { mode: "off", prefix: "", suffixNamespace: "", depositorName: "", email: "", registrant: "" },
};

/** What the series is before an admin changes anything: switched off, with a person reviewing every report. */
export const REPORT_DEFAULTS = {
  enabled: false,
  humanReview: true,
  series: { name: "Openscholar Reports", issn: "", byline: "This publication is an Openscholar Report, ISSN {issn}, {doi}" } satisfies Series,
  publication: NO_PUBLICATION,
  // One new report a day for a person's own workspace. An organisation's has none until an admin opens it, since
  // anyone can make an organisation.
  perDay: 1,
  orgPerDay: 0,
  metadataModelId: DEFAULT_TEXT_MODEL,
  metadataEffort: DEFAULT_TEXT_EFFORT as Effort | undefined,
  checks: DEFAULT_CHECKS,
  checksVersion: 1,
  agreement: { version: 1, text: DEFAULT_AGREEMENT },
};

export type WorkspaceKind = "personal" | "organization";
/** The reports a workspace may start in a day: the number it was given, else the one for its kind. A person's
 * number is their own workspace's and nothing to do with the organisations they are in. */
export const limitFor = (defaults: { perDay: number; orgPerDay: number }, kind: WorkspaceKind, own: number | null | undefined) => own ?? (kind === "personal" ? defaults.perDay : defaults.orgPerDay);
/** How long a start counts against its workspace. */
export const START_COUNTS_MS = 24 * 60 * 60 * 1000;
/** What a workspace that has used up its day's reports, or has none, is told. */
export const limitWords = (perDay: number, kind: WorkspaceKind) =>
  kind === "personal"
    ? perDay === 0
      ? "Publishing isn't open to your account yet."
      : `You can start ${perDay} ${perDay === 1 ? "report" : "reports"} a day. Come back tomorrow.`
    : perDay === 0
      ? "Publishing isn't open to this workspace yet. You can publish from your own."
      : `This workspace can start ${perDay} ${perDay === 1 ? "report" : "reports"} a day. Come back tomorrow.`;

/** A report needs a DOI, so publishing needs Crossref or Zenodo connected. */
export const canRegister = (publication: PublicationSettings) => publication.zenodo.mode !== "off" || publication.crossref.mode !== "off";
/** The byline a report's PDF must carry, with its DOI and the series' ISSN filled in. */
export const bylineOf = (series: Series, doi: string) => series.byline.replace("{doi}", `https://doi.org/${doi}`).replace("{issn}", series.issn || "pending").replace("{series}", series.name);
/** The DOI a report gets under the Crossref prefix and namespace. With Crossref off its DOI is the one Zenodo reserves, which only Zenodo knows. */
export const crossrefDoiOf = ({ crossref }: PublicationSettings, key: string) => (crossref.mode === "off" ? null : `${crossref.prefix}/${crossref.suffixNamespace}.${key.toLowerCase()}`);

/** Whether text is an ISSN: eight digits as 1234-5678, the last of them the check digit (X for ten), as ISO 3297 has it. */
export function isIssn(text: string) {
  if (!/^\d{4}-\d{3}[\dX]$/.test(text)) return false;
  const digits = text.replace("-", "");
  const sum = [...digits.slice(0, 7)].reduce((total, digit, i) => total + Number(digit) * (8 - i), 0);
  const check = (11 - (sum % 11)) % 11;
  return (check === 10 ? "X" : String(check)) === digits[7];
}
