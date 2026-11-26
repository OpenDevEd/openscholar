// Openscholar Reports' settings as Convex keeps them and its pages read them (plans/publish-reports): what the
// series starts with, and the words each rule is told to a person in.
import type { PublicationSettings } from "../../convex/evidenceLibraries/publicationValidators";
import type { Effort } from "../ai/core/call-options";
import { JEV_MODEL } from "../ai/decisions";
import { DEFAULT_AGREEMENT } from "./agreement-text";
import { DEFAULT_PRICES, type Licence } from "./report";
import { DEFAULT_IDENTIFIERS, settingsProblem, withAccounts, type Identifiers } from "./identifiers";
import { INTAKE_OFF } from "./intake";

/** A licence as the byline names it: a Creative Commons one by its short name, an author's own with its address too, since its name alone says nothing of what it allows. */
export const licenceInByline = (licence: Licence) => (typeof licence === "string" ? licence : `${licence.name} (${licence.url})`);

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
  /** Asked about the report's details and its PDF's text. `{byline}`, `{doi}` and `{licence}` are this report's. */
  question: string;
  /** What the author is told to do when the check fails, with `{byline}`, `{doi}` and `{licence}` filled in as in the question. */
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
/** The most new reports a day that are counted against a workspace's plan. */
export const MAX_DAILY_LIMIT = 1000;

export const DEFAULT_CHECKS: Check[] = [
  {
    id: "byline",
    name: "Byline and DOI in the PDF",
    question: 'Does the text include this line, allowing for line breaks and spacing: "{byline}"?',
    fix: "Put this line on the cover or the inside cover, as text and not as a picture, then upload the PDF again: {byline}",
    modelId: JEV_MODEL,
    threshold: 0.8,
    blocking: true,
    enabled: true,
  },
  {
    id: "published",
    // Named for what passing means: "Already published: Passed" read as if it had been.
    name: "Not published before",
    question: "Is this report the same work as the record found?",
    fix: "If this is your own earlier publication, tell the reviewer where it appeared.",
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
    id: "rights",
    // A PDF that says "All rights reserved" published under CC BY tells its readers two things: they can't know which holds.
    name: "Rights match the licence",
    // A copyright notice is not a licence: "© 2026 Turkana Water Trust" stands beside CC BY, and a walker's report was held for one.
    question: 'Does every statement of rights or licence in the text agree with "{licence}"? A copyright notice ("© 2026 A Name", "Copyright A Name") names who holds the rights and agrees with any licence. "All rights reserved", a ban on copying or sharing, or another licence\'s name disagrees with an open licence. The line naming {licence} that Openscholar adds agrees.',
    fix: "Take out or change the rights statement in the PDF so it says {licence}, then upload the PDF again.",
    modelId: JEV_MODEL,
    threshold: 0.7,
    // A reviewer decides: an older edition's notice may be fine.
    blocking: false,
    enabled: true,
  },
  {
    id: "research",
    name: "Research, not advertising",
    question: "Is this a research output, rather than an advertisement, a sales brochure or a page that mostly links to unrelated sites? Judge its title and abstract as well as its text: a title or abstract that advertises or sells something is not a research output's.",
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
  series: { name: "Openscholar Reports", issn: "", byline: "Published in {series} (ISSN {issn}), {doi}, under {licence}" } satisfies Series,
  publication: NO_PUBLICATION,
  prices: DEFAULT_PRICES,
  identifiers: DEFAULT_IDENTIFIERS,
  intake: INTAKE_OFF,
  metadataModelId: DEFAULT_TEXT_MODEL,
  metadataEffort: DEFAULT_TEXT_EFFORT as Effort | undefined,
  checks: DEFAULT_CHECKS,
  checksVersion: 1,
  agreement: { version: 1, text: DEFAULT_AGREEMENT },
};

export type WorkspaceKind = "personal" | "organization";
/** How long a start counts against its workspace's day. */
export const DAY_MS = 24 * 60 * 60 * 1000;
/** What a workspace whose plan's new reports for the day are used up, or that has none, is told. */
export const startWords = (perDay: number, kind: WorkspaceKind) => {
  const plan = kind === "personal" ? "Your plan" : "This workspace's plan";
  return perDay === 0 ? `${plan} doesn't include publishing. Move to a plan that does.` : `${plan} starts ${perDay} ${perDay === 1 ? "report" : "reports"} a day. Come back tomorrow, or move to a plan with more.`;
};

/**
 * Whether reports can be published: the identifier services whose accounts are connected leave every report an
 * identifier to print in its byline (lib/reports/identifiers.ts). A Crossref DOI, or a DOCiD minted at signing.
 */
export const canRegister = (publication: PublicationSettings, identifiers: Identifiers = DEFAULT_IDENTIFIERS) => settingsProblem(withAccounts(identifiers, publication)) === null;
/** The series a report is published in: the name it was signed under, which its byline prints, and the ISSN as the series has it now. */
export const seriesOf = (report: { seriesName?: string }, series: Pick<Series, "name" | "issn">) => ({ name: report.seriesName ?? series.name, issn: series.issn });
/**
 * The byline as the series words it, less its ISSN, for a series that has none: "ISSN {issn}" goes with the brackets
 * it filled and one of the separators around it, so no "()", "ISSN:" or ",," is left. The rest of the line stays.
 */
const GAP = "\u0000";
const withoutIssn = (byline: string) =>
  byline
    .replace(/(?:\bISSN\b\s*:?\s*)?\{issn\}/i, GAP)
    .replace(/\s*[([]\s*\u0000\s*[)\]]/, GAP)
    .replace(/\s*[,;]\s*\u0000(?=\s*[,;:)\]]|\s*$)/, "")
    .replace(/(^|[([])\s*\u0000\s*[,;:]\s*/, "$1")
    .replace(/\s*\u0000/, "");
/** The byline a report's PDF must carry, its parts filled in: `printed` is the address of the identifier the report prints, its DOI's or its DOCiD's. */
export const bylineOf = (series: Series, printed: string, licence: Licence) =>
  (series.issn ? series.byline.replace("{issn}", series.issn) : withoutIssn(series.byline)).replace("{doi}", printed).replace("{series}", series.name).replace("{licence}", licenceInByline(licence));
/** The DOI a report gets under the Crossref prefix and namespace; with Crossref off, none (canRegister). */
export const crossrefDoiOf = ({ crossref }: PublicationSettings, key: string) => (crossref.mode === "off" ? null : `${crossref.prefix}/${crossref.suffixNamespace}.${key.toLowerCase()}`);

/** Whether text is an ISSN: eight digits as 1234-5678, the last of them the check digit (X for ten), as ISO 3297 has it. */
export function isIssn(text: string) {
  if (!/^\d{4}-\d{3}[\dX]$/.test(text)) return false;
  const digits = text.replace("-", "");
  const sum = [...digits.slice(0, 7)].reduce((total, digit, i) => total + Number(digit) * (8 - i), 0);
  const check = (11 - (sum % 11)) % 11;
  return (check === 10 ? "X" : String(check)) === digits[7];
}
