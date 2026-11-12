import { v } from "convex/values";
import { effortValidator, modelSummaryValidator } from "../aiModelConfig/validators";
import { keptCustomValidator, publicationSettingsValidator } from "../evidenceLibraries/publicationValidators";
import { capped } from "../lib/listCaps";
import { affiliationValidator } from "../lib/validators";
import { MAX_CHECKS } from "../../lib/reports/settings";
import { CHANGE_STAGES, DETAIL_CAPS, RELATION_KINDS, REPORTS_PER_PAGE, STAGES, STATUSES, STEPS } from "../../lib/reports/report";

/** A check as kept: `lib/reports/settings.ts` says what each part means. */
export const checkValidator = v.object({
  id: v.string(),
  name: v.string(),
  question: v.string(),
  fix: v.optional(v.string()),
  modelId: v.string(),
  effort: v.optional(effortValidator),
  threshold: v.number(),
  blocking: v.boolean(),
  enabled: v.boolean(),
  builtIn: v.optional(v.literal("already-published")),
});

export const checksValidator = capped(v.array(checkValidator), MAX_CHECKS);

/** The checks as the admin page shows them, each with its model as the catalog has it, or null when it has left. */
export const checkSummariesValidator = capped(v.array(v.object({ ...checkValidator.fields, model: v.union(modelSummaryValidator, v.null()) })), MAX_CHECKS);

/** The checks as an author's page names them: nothing of what each asks, how sure it must be or what runs it. */
export const checkNamesValidator = capped(v.array(v.object({ id: v.string(), name: v.string(), blocking: v.boolean() })), MAX_CHECKS);

export const seriesValidator = v.object({ name: v.string(), issn: v.string(), byline: v.string() });

/** The one settings row, once an admin changes something. Until then the series runs on `REPORT_DEFAULTS`. */
export const reportSettingsFields = {
  enabled: v.boolean(),
  humanReview: v.boolean(),
  series: seriesValidator,
  /** The Zenodo and Crossref accounts reports register with: the settings a community has, kept the same way. */
  publication: publicationSettingsValidator,
  /** Their credentials, encrypted (convex/lib/crypto.ts). Never sent to a page. */
  encryptedCredentials: v.optional(v.string()),
  /** The own accounts, kept while a registrar runs on the sandbox: Crossref's details, and their secrets encrypted. */
  customAccounts: v.optional(keptCustomValidator),
  encryptedCustomCredentials: v.optional(v.string()),
  publicationSavedAt: v.optional(v.number()),
  perDay: v.number(),
  orgPerDay: v.number(),
  metadataModelId: v.string(),
  metadataEffort: v.optional(effortValidator),
  checks: checksValidator,
  checksVersion: v.number(),
  agreement: v.object({ version: v.number(), text: v.string(), updatedAt: v.optional(v.number()) }),
  updatedAt: v.number(),
};

// A report (lib/reports/report.ts says what each part means). What a list reads is on the report's own row; its
// details, its checks' answers and its reviewers' decisions are on a row of their own, read when it is opened.

const literals = <T extends string>(values: readonly T[]) => v.union(...values.map((value) => v.literal(value)));

export const checkResultValidator = v.object({
  checkId: v.string(),
  name: v.string(),
  /** The model that answered, by name: an admin's to read, never an author's. */
  model: v.string(),
  pass: v.boolean(),
  blocking: v.boolean(),
  answer: v.optional(v.union(v.literal("yes"), v.literal("no"), v.literal("unclear"))),
  confidence: v.optional(v.number()),
  threshold: v.optional(v.number()),
  reasoning: v.optional(v.string()),
  detail: v.optional(v.string()),
  evidence: v.optional(v.object({ title: v.string(), url: v.string(), where: v.optional(v.string()) })),
  fix: v.optional(v.string()),
  errored: v.optional(v.boolean()),
});
export const checkResultsValidator = capped(v.array(checkResultValidator), MAX_CHECKS);
/** The same list where a row may not have one yet: the cap is the list's, so it wraps the optional. */
const optionalResults = capped(v.optional(v.array(checkResultValidator)), MAX_CHECKS);
/** The answers as an author's page gets them: without the model behind each. */
export const plainResults = capped(v.array(v.object(checkResultValidator.omit("model").fields)), MAX_CHECKS);
/** The same list where a report may have none yet: the cap is told through the optional, as `optionalResults` is. */
export const optionalPlainResults = capped(v.optional(v.array(v.object(checkResultValidator.omit("model").fields))), MAX_CHECKS);

export const metadataValidator = v.object({
  title: v.string(),
  subtitle: v.string(),
  type: v.string(),
  language: v.string(),
  date: v.string(),
  licence: v.literal("CC BY 4.0"),
  authors: capped(v.array(v.object({ name: v.string(), orcid: v.string(), orcidFound: v.optional(v.string()), openalexId: v.union(v.string(), v.null()), affiliations: capped(v.array(affiliationValidator), DETAIL_CAPS.affiliations), corresponding: v.boolean(), roles: capped(v.array(v.string()), DETAIL_CAPS.roles) })), DETAIL_CAPS.authors),
  abstract: v.string(),
  topics: capped(v.array(v.object({ id: v.string(), name: v.string(), score: v.number() })), DETAIL_CAPS.topics),
  keywords: capped(v.array(v.string()), DETAIL_CAPS.keywords),
  sdgs: capped(v.array(v.string()), DETAIL_CAPS.sdgs),
  studyDesigns: capped(v.array(v.string()), DETAIL_CAPS.studyDesigns),
  countries: capped(v.array(v.string()), DETAIL_CAPS.countries),
  funding: capped(v.array(v.object({ funder: v.object({ id: v.union(v.string(), v.null()), name: v.string() }), awards: capped(v.array(v.string()), DETAIL_CAPS.awards) })), DETAIL_CAPS.funding),
  references: capped(v.array(v.string()), DETAIL_CAPS.references),
  relations: capped(v.array(v.object({ kind: literals(RELATION_KINDS.map((kind) => kind.id)), target: v.string() })), DETAIL_CAPS.relations),
});

export const stepValidator = literals(STEPS);
export const statusValidator = literals(STATUSES);
export const changeStageValidator = literals(CHANGE_STAGES);
export const stageValidator = literals(STAGES);
export const registrationValidator = v.object({ crossref: v.boolean(), zenodo: v.boolean(), policy: v.union(v.literal("mint-zenodo"), v.literal("reuse-crossref")) });
export const depositValidator = v.union(v.literal("none"), v.literal("queued"), v.literal("deposited"), v.literal("failed"));
export const archiveValidator = v.union(v.literal("none"), v.literal("draft"), v.literal("queued"), v.literal("archived"), v.literal("failed"));
export const pdfTroubleValidator = v.union(v.literal("unopened"), v.literal("textless"), v.literal("unread"));
/** Who puts the byline on a report's PDF: its author, on the cover, or Openscholar, on a last page it adds. */
export const bylineByValidator = v.union(v.literal("self"), v.literal("added"));
export const pdfValidator = v.object({
  file: v.id("_storage"),
  name: v.string(),
  bytes: v.number(),
  /** When it was uploaded, which tells one upload's reading from the next one's. */
  at: v.number(),
  /** Known once it has been opened. */
  pages: v.optional(v.number()),
  /** Its text, which the checks read, kept as a file beside it. */
  text: v.optional(v.id("_storage")),
  /** It couldn't be opened as a PDF, it holds no text (a scan), or its details couldn't be read from it: the author is told which. */
  trouble: v.optional(pdfTroubleValidator),
  /** Its text doesn't carry the report's byline word for word, which the byline check looks for: said at the upload, before the checks. */
  lacksByline: v.optional(v.boolean()),
  /** Who its author said adds the byline, chosen at the upload. "added" with `lacksByline` is a page that couldn't be added. A PDF from before the choice has none. */
  bylineBy: v.optional(bylineByValidator),
  /** Its last page is the one Openscholar added, which says the report's details: written again when the checks read them. */
  stamped: v.optional(v.boolean()),
  /** Its details are the ones the report had before this PDF replaced another: the author may have them read from this one instead. */
  kept: v.optional(v.boolean()),
});

export const reportFields = {
  /** The report's key, R and six digits, which its page is named by. */
  key: v.string(),
  workspaceId: v.id("workspaces"),
  /** Who started it. */
  ownerId: v.id("users"),
  doi: v.string(),
  /**
   * The line its PDF must carry, as it was when the agreement was signed: its checks look for this line for good, so
   * a later ISSN or a new wording never fails a report published before it.
   */
  byline: v.string(),
  /** The series' name its byline prints, kept from the same moment: its page, citations and registrations keep it,
   * so renaming the series names only reports signed after. A report signed before this was kept has none (seriesOf). */
  seriesName: v.optional(v.string()),
  step: stepValidator,
  status: statusValidator,
  /** A reviewer approved it, so its author can activate it whatever the settings say. */
  approved: v.optional(v.boolean()),
  /** One of its checks didn't pass, so it waits for a reviewer whatever the settings say. */
  flagged: v.optional(v.boolean()),
  /** Its author asked a person to look at a report its checks failed. */
  asked: v.optional(v.boolean()),
  /** Where its waiting changes stand, when it is live with some. */
  changes: v.optional(changeStageValidator),
  /** Its title as its details have it, for lists. */
  title: v.optional(v.string()),
  signedBy: v.object({ name: v.string(), onBehalfOfAll: v.boolean() }),
  signedAt: v.number(),
  agreementVersion: v.number(),
  checksVersion: v.optional(v.number()),
  /** The run of the checks under way and when it began, so only that run's answers are saved: a new PDF clears it. */
  run: v.optional(v.object({ id: v.string(), at: v.number(), /** It reads changes to a live report, which stays as it is meanwhile. */ changes: v.optional(v.boolean()) })),
  pdf: v.optional(pdfValidator),
  /** A picture of the PDF's first page, and when it was made. */
  cover: v.optional(v.object({ file: v.id("_storage"), at: v.number() })),
  registration: registrationValidator,
  deposit: depositValidator,
  archive: archiveValidator,
  /** Its record on Zenodo once there is one, which a correction edits, and the DOI Zenodo gave it when it mints its own. */
  zenodoRecordId: v.optional(v.string()),
  zenodoDoi: v.optional(v.string()),
  /** Why its last registration was refused or couldn't be made, for a reviewer, and how often it has been tried again. */
  registrationError: v.optional(v.string()),
  registrationTries: v.optional(v.number()),
  /** Crossref took the deposit of the record as it stands, and hasn't shown it yet: it is looked for, not sent again. */
  depositSent: v.optional(v.boolean()),
  /** Which asking to register this is: one more each time what the registrars hold has to change. */
  registrationRev: v.optional(v.number()),
  /** Until when a registering action holds the report, so two never register it at once. */
  registrationLease: v.optional(v.number()),
  /** A draft Zenodo made for it that isn't published yet: the next try carries on from it. */
  zenodoDraftId: v.optional(v.string()),
  activatedAt: v.optional(v.number()),
  correctedAt: v.optional(v.number()),
  /** When a reviewer withdrew it after it had gone live. Its address then shows a page saying so. */
  withdrawnAt: v.optional(v.number()),
  /** A reviewer's note with their last decision. */
  note: v.optional(v.string()),
  updatedAt: v.number(),
};

export const changesValidator = v.object({
  metadata: metadataValidator,
  results: checkResultsValidator,
  checksVersion: v.number(),
  /** When they were checked, which tells one set of changes from the next. */
  at: v.number(),
  /** The author asked a person to look at changes a check refused. */
  request: v.optional(v.object({ comment: v.string(), at: v.number() })),
  /** A reviewer said no. The changes are kept for the author to change again or discard. */
  declined: v.optional(v.object({ at: v.number(), note: v.optional(v.string()) })),
});

export const reportDetailFields = {
  reportId: v.id("reports"),
  metadata: v.optional(metadataValidator),
  /** The last finished run's answers. */
  results: optionalResults,
  /** Changes to a live report as a run was given them, kept until the run ends so one that breaks loses none. */
  trying: v.optional(metadataValidator),
  /** The answers of the run under way, as each arrives. */
  running: optionalResults,
  /** What the author thinks the checks got wrong, sent with a request for a person. */
  reviewRequest: v.optional(v.object({ comment: v.string(), at: v.number() })),
  /** Changes its author made to a live report's details that haven't gone live. */
  correction: v.optional(changesValidator),
};

/** A report as a list shows it. */
export const reportRowValidator = v.object({
  key: v.string(),
  /** Its title, or its PDF's name until it has one. */
  title: v.optional(v.string()),
  step: stepValidator,
  status: statusValidator,
  approved: v.optional(v.boolean()),
  flagged: v.optional(v.boolean()),
  changes: v.optional(changeStageValidator),
  withdrawn: v.boolean(),
  note: v.optional(v.string()),
  registration: registrationValidator,
  deposit: depositValidator,
  archive: archiveValidator,
  updatedAt: v.number(),
  /** Who signed it. */
  signer: v.string(),
  coverUrl: v.union(v.string(), v.null()),
  /** Whether the person may change it, or only see it. */
  mine: v.boolean(),
});
/** A report in its workspace's list, at the stage the Publish page shows: one that passed its checks but a check flagged waits for review. */
export const authorRowValidator = v.object({ ...reportRowValidator.fields, stage: stageValidator });
export const reportRowsValidator = capped(v.array(authorRowValidator), REPORTS_PER_PAGE);
/** A report's authors by name, as its signed agreement lists them. */
export const signerNamesValidator = capped(v.array(v.string()), DETAIL_CAPS.authors);

export const reviewDecisionValidator = v.union(v.literal("approve"), v.literal("decline"), v.literal("withdraw"), v.literal("reinstate"), v.literal("approve-changes"), v.literal("decline-changes"), v.literal("edit"));
/** A reviewer's word on a report, or on changes to a live one: who gave it and when. One row each, oldest first by creation. */
export const reportReviewFields = { reportId: v.id("reports"), decision: reviewDecisionValidator, by: v.id("users"), at: v.number(), note: v.optional(v.string()) };
/** Which report a stored file is: its PDF, the picture of its first page, or its text. A file with a row here is never another report's. */
export const reportFileFields = { file: v.id("_storage"), reportId: v.id("reports") };

/** What a run's details were made from: a PDF's reading, or a live report's details as they stood. */
export const runFromValidator = v.union(v.object({ pdfAt: v.number() }), v.object({ changesSince: v.number() }));

/** A report as the reviewers' list shows it: a list row without whether it is the reader's, with its DOI and whether its author asked for a person. */
export const adminRowValidator = v.object({ ...reportRowValidator.omit("mine").fields, doi: v.string(), asked: v.optional(v.boolean()), /** Its first author as typed on the report, with the country they work in. */ first: v.optional(v.object({ name: v.string(), country: v.optional(v.string()) })), /** Its PDF, by when it was uploaded: what a reviewer's word is given on. */ pdfAt: v.optional(v.number()) });
/** The reviewers' list holds 8 to a page (convex/reports/review.ts `REVIEW_PER_PAGE`). */
export const adminRowsValidator = capped(v.array(adminRowValidator), 8);
/** One report as a reviewer reads it. */
export const adminReportValidator = v.object({
  ...adminRowValidator.fields,
  byline: v.string(),
  /** Who started it, with the address only a reviewer sees. */
  owner: v.object({ name: v.string(), email: v.string() }),
  /** The organisation whose workspace it is; null for its owner's own. */
  workspace: v.union(v.string(), v.null()),
  signedAt: v.number(),
  onBehalfOfAll: v.boolean(),
  agreementVersion: v.number(),
  checksVersion: v.optional(v.number()),
  run: v.optional(v.object({ at: v.number(), changes: v.boolean() })),
  pdf: v.optional(v.object({ name: v.string(), bytes: v.number(), at: v.number(), pages: v.optional(v.number()), trouble: v.optional(pdfTroubleValidator), lacksByline: v.optional(v.boolean()), kept: v.optional(v.boolean()), url: v.union(v.string(), v.null()) })),
  metadata: v.optional(metadataValidator),
  results: capped(v.optional(v.array(checkResultValidator)), MAX_CHECKS),
  reviewRequest: v.optional(v.object({ comment: v.string(), at: v.number() })),
  correction: v.optional(changesValidator),
  activatedAt: v.optional(v.number()),
  correctedAt: v.optional(v.number()),
  /** Reviewers' words on it, oldest first, each by name. */
  reviews: capped(v.array(v.object({ decision: reviewDecisionValidator, by: v.string(), at: v.number(), note: v.optional(v.string()) })), 50),
  /** What a registrar said when it refused the report, or couldn't be reached. */
  registrationError: v.optional(v.string()),
  /** The emails about it, oldest first: what each was and who it went to. `failed` when it couldn't be sent. */
  emails: capped(v.array(v.object({ event: v.string(), audience: v.union(v.literal("team"), v.literal("author"), v.literal("admins")), at: v.number(), failed: v.optional(v.boolean()) })), 50),
  humanReview: v.boolean(),
});
export const signedAgreementValidator = v.object({ text: v.string(), version: v.number(), signer: v.string(), onBehalfOfAll: v.boolean(), signedAt: v.number(), byline: v.string(), doi: v.string(), title: v.optional(v.string()), authors: signerNamesValidator, pages: v.optional(v.number()) });

/** A live report as its paper page reads it, and one withdrawn after going live as its address says so. */
export const liveReportValidator = v.object({ state: v.literal("live"), key: v.string(), doi: v.string(), metadata: metadataValidator, series: v.object({ name: v.string(), issn: v.string() }), pdfUrl: v.union(v.string(), v.null()), coverUrl: v.union(v.string(), v.null()), updatedAt: v.number() });
export const withdrawnReportValidator = v.object({ state: v.literal("withdrawn"), key: v.string(), doi: v.string(), title: v.string(), authors: capped(v.array(v.string()), DETAIL_CAPS.authors), year: v.union(v.number(), v.null()), series: v.string(), withdrawnAt: v.number() });

/** An email about a report, kept on its record: who it went to, what it said, and why it didn't go if it didn't. */
export const mailAudienceValidator = v.union(v.literal("team"), v.literal("author"), v.literal("admins"));
export const reportEmailFields = { reportId: v.id("reports"), event: v.string(), audience: mailAudienceValidator, subject: v.string(), text: v.string(), at: v.number(), error: v.optional(v.string()) };
