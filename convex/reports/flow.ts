// A report from its agreement to ready to activate (plans/publish-reports): what the Publish page reads and the
// changes its author makes. A report is its workspace's. Every member of an organisation's workspace sees its
// reports; the report's owner, who started it, and the workspace's admins change them.
import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { type MutationCtx, type QueryCtx } from "../lib/functions";
import { refuseApps } from "../lib/auth";
import { createError } from "../lib/errors";
import { workspaceMutation, workspaceQuery } from "../lib/userActions";
import type { Actor } from "../workspaces/actor";
import { workspacesOf } from "../workspaces/personal";
import { bylineOf, canRegister } from "../../lib/reports/settings";
import { DETAILS_MAX_BYTES, DETAIL_CAPS, DETAIL_TEXT, FILE_NAME_MAX, REPORTS_PER_PAGE, REVIEW_TEXT_MAX, SIGNER_NAME_MAX, STAGES, canDiscard, isOrcid, keyOf, providersOf, stageOf, underWay, type Metadata, type Stage } from "../../lib/reports/report";
import { countStart, startsLeft } from "./limits";
import { reportSettings, settingsRow } from "./settings";
import { metadataValidator, pdfTroubleValidator, plainResults, reportRowValidator, reportRowsValidator, signerNamesValidator } from "./validators";

/** What someone who sees a workspace's report but may not change it is told. */
export const OWNERS_ONLY = "Only this report's owner and the workspace's admins can change it.";
/** What a change is told when the report moved on in another tab or under a reviewer's hand. The page follows by itself. */
export const MOVED_ON = "This report has moved on, so that can't be done any more.";
/** The largest PDF a report takes, and the largest picture of its first page. */
export const REPORT_PDF_MAX_MB = 50;
const COVER_MAX_BYTES = 2 * 1024 * 1024;
/** The most reports a workspace holds, which `sign` enforces: its list and its counts read them all. */
const MAX_WORKSPACE_REPORTS = 1_000;

const byKey = (ctx: QueryCtx, key: string) => ctx.db.query("reports").withIndex("by_key", (q) => q.eq("key", key)).unique();
export const detailsOf = async (ctx: QueryCtx, reportId: Id<"reports">) => (await ctx.db.query("reportDetails").withIndex("by_reportId", (q) => q.eq("reportId", reportId)).unique())!;
export const mayChange = (actor: Pick<Actor, "userId" | "role">, report: Pick<Doc<"reports">, "ownerId">) => actor.role === "admin" || report.ownerId === actor.userId;

/** A report of the workspace the person acts in, by its key, that they may change. */
async function changing(ctx: QueryCtx, actor: Actor, key: string) {
  const report = await byKey(ctx, key);
  if (!report || report.workspaceId !== actor.workspaceId) throw createError("NOT_FOUND", "This report isn't one of this workspace's, or it was discarded.");
  if (!mayChange(actor, report)) throw createError("FORBIDDEN", OWNERS_ONLY);
  return report;
}

/** When a report changes now: always later than its last change, since a form is told from the report it was opened on by this. */
export const changedAt = (report: Pick<Doc<"reports">, "updatedAt">) => Math.max(Date.now(), report.updatedAt + 1);
export const touch = (ctx: MutationCtx, report: Doc<"reports">, patch: Partial<Doc<"reports">>) => ctx.db.patch("reports", report._id, { ...patch, updatedAt: changedAt(report) });

/** A report's details as they may be kept: each list within its cap, said in words, and the whole within its size. */
export function keptDetails(metadata: Metadata) {
  const over = (Object.keys(DETAIL_CAPS) as Array<keyof typeof DETAIL_CAPS>).find((list) => list in metadata && (metadata[list as keyof Metadata] as unknown[]).length > DETAIL_CAPS[list]);
  if (over) throw createError("VALIDATION_ERROR", `A report holds at most ${DETAIL_CAPS[over].toLocaleString("en")} ${over === "studyDesigns" ? "study designs" : over === "sdgs" ? "goals" : over === "relations" ? "links" : over}.`);
  for (const text of ["title", "subtitle", "abstract"] as const) if (metadata[text].length > DETAIL_TEXT[text]) throw createError("VALIDATION_ERROR", `Keep the ${text} to ${DETAIL_TEXT[text].toLocaleString("en")} characters.`);
  const wrong = metadata.authors.find((author) => author.orcid && !isOrcid(author.orcid));
  if (wrong) throw createError("VALIDATION_ERROR", `${wrong.orcid} isn't an ORCID iD. One looks like 0000-0002-1825-0097.`);
  if (JSON.stringify(metadata).length > DETAILS_MAX_BYTES) throw createError("VALIDATION_ERROR", "These details are too long to save. Shorten the abstract or the lists.");
  return metadata;
}

const claimOf = (ctx: QueryCtx, file: Id<"_storage">) => ctx.db.query("reportFiles").withIndex("by_file", (q) => q.eq("file", file)).unique();

/** Deletes files that are a report's, with the rows that say so. */
export async function forget(ctx: MutationCtx, ...files: Array<Id<"_storage"> | undefined>) {
  for (const file of files) {
    if (!file) continue;
    const claim = await claimOf(ctx, file);
    if (claim) await ctx.db.delete("reportFiles", claim._id);
    if (await ctx.db.system.get(file)) await ctx.storage.delete(file);
  }
}

/** How long after it was uploaded a file can still become a report's. */
const UPLOAD_FRESH_MS = 15 * 60 * 1000;

/**
 * A file the browser says it just uploaded for a report, if it can be: it exists, it is no report's yet, and it was
 * uploaded moments ago. A storage ID is only ever known to the browser that uploaded it, so a fresh one that nothing
 * claims is that upload. An older one, or one a report holds, is refused and left alone: it may be someone's file.
 */
async function uploaded(ctx: MutationCtx, file: Id<"_storage">) {
  const stored = await ctx.db.system.get(file);
  if (!stored || (await claimOf(ctx, file)) || Date.now() - stored._creationTime > UPLOAD_FRESH_MS) return null;
  return stored;
}

/** How many more reports the workspace may start at `now`, which the page gives so this query doesn't read the clock. */
export const starts = workspaceQuery({
  args: { now: v.number() },
  returns: v.object({ kind: v.union(v.literal("personal"), v.literal("organization")), perDay: v.number(), left: v.number() }),
  handler: (ctx, { workspaceId }, { now }) => startsLeft(ctx, workspaceId, now),
});

/**
 * Signs the agreement, which starts a report of the workspace's and reserves its DOI. Each signing starts one, and a
 * workspace may start only so many a day. `version` is the agreement the person read: one changed since is read
 * again before it's signed. Answers the new report's key.
 */
export const sign = workspaceMutation({
  args: { name: v.string(), onBehalfOfAll: v.boolean(), version: v.number() },
  returns: v.string(),
  handler: async (ctx, { userId, workspaceId }, { name, onBehalfOfAll, version }) => {
    await refuseApps(ctx);
    const settings = await settingsRow(ctx);
    if (!settings.enabled || !canRegister(settings.publication)) throw createError("FEATURE_DISABLED", "Publishing is off for now.");
    if (version !== settings.agreement.version) throw createError("CONFLICT", "The agreement changed while you were reading it. Read the new one, then sign.");
    const signer = name.trim();
    if (!signer) throw createError("VALIDATION_ERROR", "Type your name to sign.");
    if (signer.length > SIGNER_NAME_MAX) throw createError("VALIDATION_ERROR", `Keep your name to ${SIGNER_NAME_MAX} characters.`);
    const { crossref, zenodo } = settings.publication;
    // ponytail: a report registered with Zenodo alone takes the DOI Zenodo reserves, which the registration slice
    // (#1205) asks Zenodo for. Until then a report needs Crossref on, whose DOI is known as soon as it has a key.
    if (crossref.mode === "off") throw createError("FEATURE_DISABLED", "Publishing with a DOI from Zenodo alone isn't open yet.");
    // The list and its counts read a workspace's reports up to MAX_WORKSPACE_REPORTS, so a workspace holds no more than that.
    if ((await newest(ctx, workspaceId)).length >= MAX_WORKSPACE_REPORTS) throw createError("VALIDATION_ERROR", `A workspace holds at most ${MAX_WORKSPACE_REPORTS.toLocaleString("en")} reports. Discard a draft, or write to us to raise it.`);
    // Counted where it can't be undone: a report discarded later still used one of the day's starts.
    await countStart(ctx, workspaceId);
    const counter = await ctx.db.query("reportKeys").first();
    const next = counter?.next ?? 1;
    if (counter) await ctx.db.patch("reportKeys", counter._id, { next: next + 1 });
    else await ctx.db.insert("reportKeys", { next: next + 1 });
    const key = keyOf(next);
    const now = Date.now();
    const reportId = await ctx.db.insert("reports", {
      key,
      workspaceId,
      ownerId: userId,
      // Signing reserves the DOI: it's the report's from now on, and goes live when the report is activated. How
      // the report registers is fixed with it.
      doi: `${crossref.prefix}/${crossref.suffixNamespace}.${key.toLowerCase()}`,
      registration: { crossref: true, zenodo: zenodo.mode !== "off", policy: zenodo.defaultIdentifierPolicy },
      step: "doi",
      status: "draft",
      signedBy: { name: signer, onBehalfOfAll },
      signedAt: now,
      agreementVersion: version,
      deposit: "none",
      archive: "none",
      updatedAt: now,
    });
    await ctx.db.insert("reportDetails", { reportId });
    return key;
  },
});

/** The author's corrections, kept as they make them, so leaving the details step loses nothing. A title being
 * retyped is kept empty; the checks are what need one. */
export const saveDetails = workspaceMutation({
  args: { key: v.string(), metadata: metadataValidator, /** The PDF the details were read from, by when it was uploaded. */ pdfAt: v.number() },
  returns: v.null(),
  handler: async (ctx, actor, { key, metadata, pdfAt }) => {
    await refuseApps(ctx);
    const report = await changing(ctx, actor, key);
    // Only while the details are being corrected: a save that arrives after the checks started changes nothing. Nor
    // does one typed over another PDF's details, as a tab left open across a new upload would send.
    if (report.step !== "details" || report.run || report.pdf?.at !== pdfAt) return null;
    await ctx.db.patch("reportDetails", (await detailsOf(ctx, report._id))._id, { metadata: keptDetails(metadata) });
    await touch(ctx, report, { title: metadata.title.trim() || undefined });
    return null;
  },
});

/** Gives up a report that never went live and no reviewer approved: it, its PDF and its reserved DOI are gone. The
 * day's start it used stays used. */
export const discard = workspaceMutation({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, actor, { key }) => {
    await refuseApps(ctx);
    const report = await changing(ctx, actor, key);
    if (!canDiscard(report)) throw createError("CONFLICT", "Only a report that isn't approved or live can be discarded.");
    await forget(ctx, report.pdf?.file, report.pdf?.text, report.cover?.file);
    await ctx.db.delete("reportDetails", (await detailsOf(ctx, report._id))._id);
    await ctx.db.delete("reports", report._id);
    return null;
  },
});

/** Back to a step already done, or on from the DOI to the upload. A report past its checks goes back only when it
 * failed them: to replace its PDF, or to change the details its PDF was read into. */
export const goTo = workspaceMutation({
  args: { key: v.string(), step: v.union(v.literal("doi"), v.literal("upload"), v.literal("details")) },
  returns: v.null(),
  handler: async (ctx, actor, { key, step }) => {
    await refuseApps(ctx);
    const report = await changing(ctx, actor, key);
    const checked = report.step === "done";
    if (checked && stageOf(report, (await reportSettings(ctx)).humanReview) !== "failed") throw createError("CONFLICT", MOVED_ON);
    const details = step === "details" ? await detailsOf(ctx, report._id) : null;
    if (step === "details" && !details?.metadata) throw createError("CONFLICT", "That step isn't open for this report yet.");
    await touch(ctx, report, { step });
    return null;
  },
});

/** Where the browser sends a report's PDF, and the picture of its first page, before attaching them. */
export const startUpload = workspaceMutation({
  args: { key: v.string() },
  returns: v.string(),
  handler: async (ctx, actor, { key }) => {
    await refuseApps(ctx);
    const report = await changing(ctx, actor, key);
    if (report.step === "done") throw createError("CONFLICT", MOVED_ON);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * The PDF the browser just uploaded becomes the report's, with the picture it drew of its first page, and its text
 * and details are read next (./reading.ts).
 * A new PDF starts over: the details read from the one before it are gone until this one is read. A file that
 * can't be this report's is deleted, and why is the answer: a throw would keep the file.
 */
export const attachPdf = workspaceMutation({
  args: { key: v.string(), file: v.id("_storage"), name: v.string(), cover: v.optional(v.id("_storage")) },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, actor, { key, file, name, cover }) => {
    await refuseApps(ctx);
    const stored = await uploaded(ctx, file);
    const picture = cover ? await uploaded(ctx, cover) : null;
    if (!stored) return "The upload didn't arrive. Upload the PDF again.";
    // From here both files are this upload's, so whatever isn't kept is deleted.
    const report = await byKey(ctx, key);
    const refused =
      !report || report.workspaceId !== actor.workspaceId ? "This report isn't one of this workspace's, or it was discarded."
      : !mayChange(actor, report) ? OWNERS_ONLY
      : report.step === "done" ? MOVED_ON
      : !/\.pdf$/i.test(name.trim()) ? "Choose a PDF."
      : stored.size === 0 ? "That file is empty. Choose the PDF again."
      : stored.size > REPORT_PDF_MAX_MB * 1024 * 1024 ? `A report's PDF is at most ${REPORT_PDF_MAX_MB} MB.`
      : null;
    if (refused || !report) {
      await forget(ctx, file, picture ? cover : undefined);
      return refused;
    }
    await forget(ctx, report.pdf?.file, report.pdf?.text, report.cover?.file);
    const at = Date.now();
    // The picture of its first page, drawn by the browser that uploaded it. One that is too big or no picture is
    // dropped, and the report keeps its title page.
    const pictured = !!picture && picture.size <= COVER_MAX_BYTES && (picture.contentType === undefined || picture.contentType.startsWith("image/"));
    if (picture && !pictured) await forget(ctx, cover);
    await ctx.db.insert("reportFiles", { file, reportId: report._id });
    if (pictured) await ctx.db.insert("reportFiles", { file: cover!, reportId: report._id });
    await ctx.db.patch("reportDetails", (await detailsOf(ctx, report._id))._id, { metadata: undefined, reviewRequest: undefined, running: undefined });
    await touch(ctx, report, { pdf: { file, name: name.trim().slice(-FILE_NAME_MAX), bytes: stored.size, at }, cover: pictured ? { file: cover!, at } : undefined, run: undefined, step: "upload", title: undefined, approved: undefined, asked: undefined });
    await ctx.scheduler.runAfter(0, internal.reports.reading.read, { reportId: report._id, at });
    return null;
  },
});

/**
 * The author of a report its checks failed asks a person to look, with what they think the checks got wrong. That
 * shows the words to a reviewer and nothing else: a reviewer can approve or decline any report, asked or not.
 */
export const requestReview = workspaceMutation({
  args: { key: v.string(), comment: v.string() },
  returns: v.null(),
  handler: async (ctx, actor, { key, comment }) => {
    await refuseApps(ctx);
    const report = await changing(ctx, actor, key);
    // Asked of a report its checks failed and no one has approved since: anything else has moved on.
    if (stageOf(report, (await reportSettings(ctx)).humanReview) !== "failed") throw createError("CONFLICT", MOVED_ON);
    if (report.asked) return null;
    await ctx.db.patch("reportDetails", (await detailsOf(ctx, report._id))._id, { reviewRequest: { comment: comment.trim().slice(0, REVIEW_TEXT_MAX), at: Date.now() } });
    await touch(ctx, report, { asked: true });
    return null;
  },
});

/**
 * The author makes a report live once no review is owed. Its registrations are queued in the order its route fixed
 * when its DOI was reserved (lib/reports/report.ts `providersOf`).
 */
export const activate = workspaceMutation({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, actor, { key }) => {
    await refuseApps(ctx);
    const report = await changing(ctx, actor, key);
    const settings = await reportSettings(ctx);
    const stage = stageOf(report, settings.humanReview);
    if (stage === "live") throw createError("CONFLICT", "This report is already live.");
    if (stage === "review") throw createError("CONFLICT", "A reviewer has to approve this report before you can activate it.");
    if (stage !== "ready") throw createError("CONFLICT", MOVED_ON);
    // A DOI needs somewhere to register: with both registrars switched off, nothing goes live.
    if (!canRegister(settings.publication)) throw createError("FEATURE_DISABLED", "Publishing is paused for now, so nothing can go live. Your report keeps its place.");
    const registers = providersOf(report.registration);
    await touch(ctx, report, { status: "live", activatedAt: Date.now(), deposit: registers.includes("crossref") ? "queued" : "none", archive: registers.includes("zenodo") ? "queued" : "none" });
    return null;
  },
});

/** A live report of the workspace's with changes waiting, as the screen the change came from saw them: ones sent since, say from another tab, are never the ones discarded or asked about. */
async function waitingChanges(ctx: QueryCtx, actor: Actor, key: string, seenAt: number) {
  const report = await changing(ctx, actor, key);
  const details = await detailsOf(ctx, report._id);
  if (report.status !== "live" || !details.correction) throw createError("CONFLICT", "This report has no changes waiting any more.");
  if (details.correction.at !== seenAt) throw createError("CONFLICT", "You changed the details again since this page opened. It shows those changes now.");
  return { report, details, correction: details.correction };
}

/**
 * The author of changes a check refused asks a person to look, with what they think the check got wrong. The
 * changes then wait for a reviewer.
 */
export const requestChangesReview = workspaceMutation({
  args: { key: v.string(), seenAt: v.number(), comment: v.string() },
  returns: v.null(),
  handler: async (ctx, actor, { key, seenAt, comment }) => {
    await refuseApps(ctx);
    const { report, details, correction } = await waitingChanges(ctx, actor, key, seenAt);
    if (report.changes === "declined") throw createError("CONFLICT", "A reviewer declined these changes. Their note is on the page now.");
    // Already with a reviewer: asking again tells no one anything new.
    if (report.changes === "review") return null;
    await ctx.db.patch("reportDetails", details._id, { correction: { ...correction, request: { comment: comment.trim().slice(0, REVIEW_TEXT_MAX), at: Date.now() } } });
    await touch(ctx, report, { changes: "review" });
    return null;
  },
});

/** The author gives up changes that haven't gone live. The report stays as it is. A run still reading them is given up with them. */
export const discardChanges = workspaceMutation({
  args: { key: v.string(), seenAt: v.number() },
  returns: v.null(),
  handler: async (ctx, actor, { key, seenAt }) => {
    await refuseApps(ctx);
    const { report, details } = await waitingChanges(ctx, actor, key, seenAt);
    await ctx.db.patch("reportDetails", details._id, { correction: undefined, running: undefined });
    await touch(ctx, report, { changes: undefined, ...(report.run?.changes && { run: undefined }) });
    return null;
  },
});

const stageValidator = v.union(...STAGES.map((stage) => v.literal(stage)));
const rowValidator = reportRowValidator;

async function row(ctx: QueryCtx, actor: Actor, report: Doc<"reports">): Promise<Infer<typeof rowValidator>> {
  const { key, step, status, approved, flagged, changes, note, registration, deposit, archive, updatedAt } = report;
  return {
    key, step, status, registration, deposit, archive, updatedAt,
    ...(approved && { approved }),
    ...(flagged && { flagged }),
    ...(changes && { changes }),
    ...(note && { note }),
    ...((report.title ?? report.pdf?.name) && { title: report.title ?? report.pdf?.name }),
    withdrawn: report.withdrawnAt !== undefined,
    signer: report.signedBy.name,
    coverUrl: report.cover ? await ctx.storage.getUrl(report.cover.file) : null,
    mine: mayChange(actor, report),
  };
}

// ponytail: a workspace's list and its counts read all its reports, which is what lets the list page by number and
// keep its page in the address. `sign` holds a workspace to MAX_WORKSPACE_REPORTS of them; a workspace starts a report or a
// few a day. Past that, the list pages by cursor and keeps its counts (lib/listCounts).
const newest = (ctx: QueryCtx, workspaceId: Id<"workspaces">) => ctx.db.query("reports").withIndex("by_workspaceId_and_updatedAt", (q) => q.eq("workspaceId", workspaceId)).order("desc").take(MAX_WORKSPACE_REPORTS);

/** One page of the workspace's reports, the one changed last first. `show` keeps those at one stage. A page past the last answers the last. */
export const page = workspaceQuery({
  args: { page: v.number(), show: v.optional(stageValidator) },
  returns: v.object({ rows: reportRowsValidator, page: v.number(), pages: v.number(), total: v.number() }),
  handler: async (ctx, actor, { page, show }) => {
    const { humanReview } = await reportSettings(ctx);
    const reports = await newest(ctx, actor.workspaceId);
    const listed = show ? reports.filter((report) => stageOf(report, humanReview) === show) : reports;
    const pages = Math.max(1, Math.ceil(listed.length / REPORTS_PER_PAGE));
    const at = Math.min(Math.max(1, Math.floor(page) || 1), pages);
    return { rows: await Promise.all(listed.slice((at - 1) * REPORTS_PER_PAGE, at * REPORTS_PER_PAGE).map((report) => row(ctx, actor, report))), page: at, pages, total: listed.length };
  },
});

const countFields = Object.fromEntries(STAGES.map((stage) => [stage, v.number()])) as Record<Stage, ReturnType<typeof v.number>>;

/**
 * How many of the workspace's reports are at each stage, and how many are under way: with one, Publish carries on
 * with it (`only`), with several it opens the list, with none a new report.
 */
export const counts = workspaceQuery({
  args: {},
  returns: v.object({ ...countFields, all: v.number(), underWay: v.number(), only: v.union(v.string(), v.null()) }),
  handler: async (ctx, { workspaceId }) => {
    const { humanReview } = await reportSettings(ctx);
    const reports = await newest(ctx, workspaceId);
    const tally = Object.fromEntries(STAGES.map((stage) => [stage, 0])) as Record<Stage, number>;
    for (const report of reports) tally[stageOf(report, humanReview)] += 1;
    const going = reports.filter(underWay);
    return { ...tally, all: reports.length, underWay: going.length, only: going.length === 1 ? going[0]!.key : null };
  },
});

const reportValidator = v.object({
  ...rowValidator.fields,
  doi: v.string(),
  /** The line its PDF must carry, with its DOI and the series' ISSN as they are now. */
  byline: v.string(),
  asked: v.boolean(),
  signedAt: v.number(),
  onBehalfOfAll: v.boolean(),
  agreementVersion: v.number(),
  checksVersion: v.optional(v.number()),
  /** The checks under way since then, with the answers that have arrived. */
  run: v.optional(v.object({ at: v.number(), results: plainResults })),
  pdf: v.optional(v.object({ name: v.string(), bytes: v.number(), at: v.number(), pages: v.optional(v.number()), trouble: v.optional(pdfTroubleValidator), url: v.union(v.string(), v.null()) })),
  metadata: v.optional(metadataValidator),
  results: v.optional(plainResults),
  reviewRequest: v.optional(v.object({ comment: v.string(), at: v.number() })),
  correction: v.optional(v.object({ metadata: metadataValidator, results: plainResults, at: v.number(), request: v.optional(v.object({ comment: v.string(), at: v.number() })), declined: v.optional(v.object({ at: v.number(), note: v.optional(v.string()) })) })),
  activatedAt: v.optional(v.number()),
  correctedAt: v.optional(v.number()),
});

const plain = (results: Doc<"reportDetails">["results"]) => results?.map(({ model: _model, ...result }) => result);

/**
 * One of the workspace's reports as its pages show it. What an author's page never gets is left out: the model
 * behind each check's answer, and who reviewed it. A report of another workspace the person is in is named by
 * `elsewhere`, so a link from an email opens it where it lives; anything else is null.
 */
export const get = workspaceQuery({
  args: { key: v.string() },
  returns: v.union(v.object({ report: reportValidator }), v.object({ elsewhere: v.object({ name: v.string(), slug: v.union(v.string(), v.null()) }) }), v.null()),
  handler: async (ctx, actor, { key }) => {
    const report = await byKey(ctx, key);
    if (!report) return null;
    if (report.workspaceId !== actor.workspaceId) {
      const its = (await workspacesOf(ctx, actor.userId)).find((workspace) => workspace._id === report.workspaceId);
      if (!its) return null;
      const organization = its.kind === "organization" ? await ctx.db.get("organizations", its.organizationId) : null;
      // An organisation's pages are under its slug; the person's own have none.
      return { elsewhere: { name: organization?.name ?? "your own workspace", slug: organization?.slug ?? null } };
    }
    const [details, settings] = await Promise.all([detailsOf(ctx, report._id), reportSettings(ctx)]);
    const { correction } = details;
    return {
      report: {
        ...(await row(ctx, actor, report)),
        doi: report.doi,
        byline: bylineOf(settings.series, report.doi),
        asked: report.asked === true,
        signedAt: report.signedAt,
        onBehalfOfAll: report.signedBy.onBehalfOfAll,
        agreementVersion: report.agreementVersion,
        ...(report.checksVersion !== undefined && { checksVersion: report.checksVersion }),
        ...(report.run && { run: { at: report.run.at, results: plain(details.running) ?? [] } }),
        ...(report.pdf && { pdf: { name: report.pdf.name, bytes: report.pdf.bytes, at: report.pdf.at, ...(report.pdf.pages !== undefined && { pages: report.pdf.pages }), ...(report.pdf.trouble && { trouble: report.pdf.trouble }), url: await ctx.storage.getUrl(report.pdf.file) } }),
        ...(details.metadata && { metadata: details.metadata }),
        ...(details.results && { results: plain(details.results) }),
        ...(details.reviewRequest && { reviewRequest: details.reviewRequest }),
        ...(correction && { correction: { metadata: correction.metadata, results: plain(correction.results)!, at: correction.at, ...(correction.request && { request: correction.request }), ...(correction.declined && { declined: correction.declined }) } }),
        ...(report.activatedAt !== undefined && { activatedAt: report.activatedAt }),
        ...(report.correctedAt !== undefined && { correctedAt: report.correctedAt }),
      },
    };
  },
});

/**
 * The agreement a report's author signed, in the wording of the version they signed, with who signed and when and
 * what the report has become since. Its workspace reads it; it can be saved or printed from its page.
 */
export const agreement = workspaceQuery({
  args: { key: v.string() },
  returns: v.union(
    v.null(),
    v.object({ text: v.string(), version: v.number(), signer: v.string(), onBehalfOfAll: v.boolean(), signedAt: v.number(), doi: v.string(), title: v.optional(v.string()), authors: signerNamesValidator, pages: v.optional(v.number()) }),
  ),
  handler: async (ctx, actor, { key }) => {
    const report = await byKey(ctx, key);
    if (!report || report.workspaceId !== actor.workspaceId) return null;
    const version = report.agreementVersion;
    const kept = await ctx.db.query("reportAgreementVersions").withIndex("by_version", (q) => q.eq("version", version)).unique();
    const { metadata } = await detailsOf(ctx, report._id);
    return {
      // Every version's wording is kept from the first change on; before one, it is the series' own.
      text: kept?.text ?? (await reportSettings(ctx)).agreement.text,
      version,
      signer: report.signedBy.name,
      onBehalfOfAll: report.signedBy.onBehalfOfAll,
      signedAt: report.signedAt,
      doi: report.doi,
      ...(metadata?.title && { title: metadata.title }),
      authors: (metadata?.authors ?? []).map((author) => author.name).filter(Boolean),
      ...(report.pdf?.pages !== undefined && { pages: report.pdf.pages }),
    };
  },
});
