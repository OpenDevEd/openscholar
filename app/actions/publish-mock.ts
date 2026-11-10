"use server";
// MOCK (mock/publish-reports): the Publish flow and its admin page, against the mock's local store. The real build
// makes these Convex functions with their user-action registry entries.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { cookies, headers } from "next/headers";
import { currentUser } from "@clerk/nextjs/server";
import { extractPdfJsTextPages } from "@/convex/extraction/pdfjs_extract";
import { accountOf, accountsMatching, actor, isAdmin, organizationAt, organizationsOf, requireAdmin, type Actor } from "@/lib/publish-mock/admin";
import { applyCorrection } from "@/lib/publish-mock/checks";
import { mail, type MailEvent } from "@/lib/publish-mock/emails";
import { readDetails } from "@/lib/publish-mock/reader";
import type { PublicationSecrets, PublicationSettings } from "@/convex/evidenceLibraries/publicationValidators";
import { renderCover } from "@/lib/publish-mock/cover";
import { CROSSREF_SANDBOX, MOCK_DIR, changeState, coverPath, nextKey, pdfPath, readState, textPath } from "@/lib/publish-mock/store";
import { SITE_URL } from "@/lib/seo/page-metadata";
import { REVIEW_TEXT_MAX, canDiscard, canPublish, canRegister, changesOf, correctionStageOf, forAuthor, isMetadata, mayChange, mayWorkOn, limitFor, startsLeft, doiOf, providersOf, registrationOf, stageOf, stepsOf, type Check, type Correction, type LimitOverride, type Metadata, type Review, limitWords, type MockState, type Refused, type Settings, type Stage, type Step, type Submission, type Workspace } from "@/lib/publish-mock/types";

/** The rail reads this to leave Publish out while the admin page has it off. */
const OFF_COOKIE = "os-publish-off";

const change = changeState;

/**
 * Something that can't be done, in words for the person who tried. A built server hides what an action throws and
 * sends a digest in its place, so every action hands a refusal back as a value (`answered`) and the page says it.
 */
class Refusal extends Error {}
const refuse = (words: string): never => {
  throw new Refusal(words);
};
async function answered<T>(run: () => Promise<T>): Promise<T | Refused> {
  try {
    return shown(await run());
  } catch (error) {
    if (error instanceof Refusal) return { refused: error.message };
    throw error;
  }
}
/** An author action's answer with every report in it as an author's page may have it (`forAuthor`). */
function shown<T>(answer: T): T {
  if (typeof answer !== "object" || answer === null) return answer;
  const a = answer as Record<string, unknown>;
  const report = (value: unknown) => (typeof value === "object" && value !== null && "doi" in value && "step" in value ? forAuthor(value as Submission) : value);
  return ("doi" in a && "step" in a ? forAuthor(answer as unknown as Submission) : { ...a, ...("draft" in a ? { draft: report(a.draft) } : {}), ...("report" in a ? { report: report(a.report) } : {}) }) as T;
}
/** What someone who sees a workspace's report but may not change it is told. */
const OWNERS_ONLY = "Only this report's owner and the workspace's admins can change it.";
/** What a refusal says when the report moved on in another tab or under a reviewer's hand. */
const MOVED_ON = "This report has moved on since this page loaded. Reload to see where it stands.";

/** What a reviewer is told when their word can't be taken because they are signed out or no longer an admin. */
const NOT_ADMIN: Refused = { refused: "You're signed out, or no longer an admin. Sign in again to review." };

/** Where an email's links start: the address this request came to, or the site's own when it names none. */
const here = async () => (await headers()).get("origin") ?? SITE_URL;

/** Who is acting. Several reports can be under way at once, so every step also says which report it means. */
async function me(): Promise<Actor> {
  return (await actor()) ?? refuse("Sign in to publish.");
}

/** A report this person may work on, by its key: their own, or one of an organisation's they are a member of. The
 * one on the screen the step came from, whichever is open elsewhere. */
function reportOf(state: MockState, id: string, who: Actor | null) {
  const report = who && state.submissions.find((s) => s.id === id && mayWorkOn(s, who.userId, who.orgIds));
  if (!report) return refuse("This report isn't one of this workspace's, or it was discarded.");
  return mayChange(report, who.userId, who.adminOf) ? report : refuse(OWNERS_ONLY);
}

function touch(submission: Submission, patch: Partial<Submission>) {
  Object.assign(submission, patch, { updatedAt: Date.now() });
  return submission;
}

/**
 * Signs the agreement, which starts a report of the person's and reserves its DOI. Each signing starts one, and a
 * person may start only so many a day (`limitFor`). `version` is the agreement the person read: one changed since
 * is read again before it's signed.
 */
export async function signAgreement({ name, onBehalfOfAll, version, workspace }: { name: string; onBehalfOfAll: boolean; version: number; /** The organisation whose workspace the page is in (/o/<slug>); none in the person's own. */ workspace?: string }): Promise<{ draft: Submission } | Refused> {
  const user = await currentUser();
  if (!user) return { refused: "Sign in to publish." };
  // The report is the workspace's it's started in: an organisation's for its members, or the person's own.
  const organization = workspace ? await organizationAt(workspace) : null;
  if (workspace && !(organization && (await organizationsOf(user.id)).includes(organization.id))) return { refused: "You're not a member of this workspace any more." };
  // Each workspace has its own limit, and every report started in it counts against it.
  const within: Workspace = organization ? { kind: "organization", id: organization.id } : { kind: "person", id: user.id };
  return change((state) => {
    if (!canPublish(state.settings)) return { refused: "Publishing is off for now." };
    if (version !== state.settings.agreement.version) return { refused: "The agreement changed while you were reading it. Reload to read the new one." };
    if (startsLeft(state, within) < 1) return { refused: limitWords(limitFor(state.settings, within), within.kind) };
    // Counted where it can't be undone: a report discarded later still used one of the day's starts.
    state.started = { ...state.started, [within.id]: [...(state.started?.[within.id] ?? []).filter((at) => Date.now() - at < 24 * 60 * 60 * 1000), Date.now()] };
    const id = nextKey(state);
    const registration = registrationOf(state.settings);
    const draft: Submission = {
      id,
      ownerId: user.id,
      ...(organization ? { orgId: organization.id, orgName: organization.name } : {}),
      signedBy: { name: name.trim(), email: user.primaryEmailAddress?.emailAddress ?? "", onBehalfOfAll },
      signedAt: Date.now(),
      agreementVersion: version,
      // Signing reserves the DOI: it's the report's from now on, and goes live when the report is activated. How
      // the report registers is fixed with it. With Zenodo on, Zenodo holds a draft for the file from here, as for
      // a community's record.
      doi: doiOf(state.settings, id),
      registration,
      archive: registration.zenodo ? "draft" : "none",
      deposit: "none",
      step: "doi",
      status: "draft",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    state.submissions.unshift(draft);
    return { draft: forAuthor(draft) };
  });
}

/** The author's corrections, kept as they make them, so leaving the details step loses nothing. A title being
 * retyped is kept empty; the checks are what need one. */
export async function saveDetails(id: string, metadata: unknown) {
  const who = await actor();
  if (!who || !isMetadata(metadata, { titled: false })) return;
  await change((state) => {
    const draft = state.submissions.find((s) => s.id === id && mayChange(s, who.userId, who.adminOf));
    // Only while the details are being corrected: a save that arrives after the checks started changes nothing.
    if (draft?.step === "details" && !draft.run) touch(draft, { metadata });
  });
}

/** Gives up a report that never went live and no reviewer approved: it, its PDF and its reserved DOI are gone. The
 * day's start it used stays used. */
export async function discardReport(id: string): Promise<null | Refused> {
  return answered(async () => {
    const who = await me();
    return change(async (state) => {
      const report = reportOf(state, id, who);
      if (!canDiscard(report)) refuse("Only a report that isn't approved or live can be discarded.");
      state.submissions = state.submissions.filter((s) => s !== report);
      await Promise.all([pdfPath(id), coverPath(id), textPath(id)].map((file) => rm(file, { force: true })));
      return null;
    });
  });
}

/** Back to a step already done, or on from the DOI to the upload. A report past its checks goes back only to
 * replace a PDF that failed them; its details open again once that PDF has been read. */
export async function goTo(id: string, step: Step): Promise<Submission | Refused> {
  return answered(async () => {
    const who = await me();
    return change((state) => {
      const draft = reportOf(state, id, who);
      const checked = draft.step === "done";
      if (checked && stageOf(draft, state.settings) !== "failed") refuse(MOVED_ON);
      if (!(step === "doi" || step === "upload" || (step === "details" && !checked && !!draft.metadata))) refuse("That step isn't open for this report yet.");
      return touch(draft, { step });
    });
  });
}

/** The PDF, kept with the report with its text and a picture of its first page. Its details are read next (`readPdfDetails`). */
export async function uploadPdf(form: FormData): Promise<Submission | Refused> {
  return answered(async () => {
    const file = form.get("pdf");
    const id = form.get("id");
    if (typeof id !== "string" || !(file instanceof File) || !/\.pdf$/i.test(file.name)) return refuse("Choose a PDF.");
    const bytes = await file.arrayBuffer();
    // pdfjs takes its buffer over, so each reader gets a copy and the original is kept.
    // The text and the cover are read side by side. A first page that can't be drawn leaves the report its title page.
    const who = await me();
    const origin = await here();
    const opened = await Promise.all([
      extractPdfJsTextPages(bytes.slice(0)),
      renderCover(bytes.slice(0)).catch((error: unknown) => {
        console.error("[publish mock] cover not drawn", String(error));
        return null;
      }),
    ]).catch(async (error: unknown) => {
      // A file that isn't a PDF pdf.js can open: the team's inbox hears of it, and the author is told to try another.
      console.error("[publish mock] the PDF couldn't be opened", { name: file.name, bytes: file.size, error: String(error).slice(0, 300) });
      await change((state) => mail(state, "pdf-unopened", { ...reportOf(state, id, who), pdf: { name: file.name, pages: 0, bytes: file.size } }, origin));
      return null;
    });
    if (!opened) return refuse("This PDF couldn't be opened. Try saving it again as a PDF.");
    const [{ pages, totalPages }, cover] = opened;
    return change(async (state) => {
      const draft = reportOf(state, id, who);
      if (draft.step === "done") refuse(MOVED_ON);
      await mkdir(MOCK_DIR, { recursive: true });
      await writeFile(pdfPath(draft.id), Buffer.from(bytes));
      if (cover) await writeFile(coverPath(draft.id), cover);
      // The text the model falls back to and the checks read, kept beside the PDF.
      await writeFile(textPath(draft.id), pages.map((p) => p.text).join("\n"));
      const at = Date.now();
      // A new PDF starts over: the details read from the one before it are gone until this one is read.
      return touch(draft, { pdf: { name: file.name, pages: totalPages, bytes: file.size, at }, run: undefined, cover: cover ? at : undefined, step: "upload", metadata: undefined, reviewRequest: undefined, approved: undefined });
    });
  });
}

/**
 * The stored PDF's details, read by the model set on the admin page, with topics from OpenAlex's classifier and
 * affiliations and funders matched to OpenAlex (lib/publish-mock/reader.ts). The report then waits at its details for
 * its author to correct them. `read` is false when the model couldn't read the PDF: the details are then left for
 * the author to fill in.
 */
export async function readPdfDetails(id: string): Promise<{ draft: Submission; read: boolean } | Refused> {
  return answered(async () => {
    const [who, user] = await Promise.all([me(), currentUser()]);
    const origin = await here();
    const state = await readState();
    const report = reportOf(state, id, who);
    if (!report.pdf || report.step === "done") return refuse(MOVED_ON);
    const { at, name } = report.pdf;
    const [pdf, text] = await Promise.all([readFile(pdfPath(id)), readFile(textPath(id), "utf8").catch(() => "")]);
    // The model reads outside the store's queue: half a minute of reading holds no one else's change up.
    const metadata = await readDetails({ pdf, text, fileName: name, ownDoi: report.doi, model: state.settings.metadataModel }).catch((error: unknown) => {
      console.error("[publish] the PDF's details couldn't be read", { id, model: state.settings.metadataModel.id, error: String(error).slice(0, 600) });
      return null;
    });
    const signer = { name: report.signedBy?.name || user?.fullName || "", orcid: "", openalexId: null, affiliations: [], corresponding: true, roles: [] };
    const details: Metadata = metadata ?? {
      title: name.replace(/\.pdf$/i, "").replace(/[-_]+/g, " "), subtitle: "", type: "report", language: "en", date: new Date().toISOString().slice(0, 10), licence: "CC BY 4.0",
      authors: [], abstract: "", topics: [], keywords: [], sdgs: [], studyDesigns: [], countries: [], funding: [], references: [], relations: [],
    };
    // A PDF that names no author is its signer's until they say otherwise.
    if (!details.authors.length) details.authors = [signer];
    return change((state) => {
      const draft = state.submissions.find((s) => s.id === id);
      // A PDF uploaded while this one was being read is the report's now: its own reading fills the details.
      if (!draft?.pdf || draft.pdf.at !== at || draft.step === "done") return refuse("A newer PDF replaced this one while it was being read. Reload to carry on with it.");
      touch(draft, { metadata: details, step: "details" });
      if (!metadata) mail(state, "pdf-unread", draft, origin);
      return { draft, read: metadata !== null };
    });
  });
}

/** A live report of this person's with changes waiting, or a refusal in words. */
function waitingChanges(state: MockState, id: string, who: Actor | null, seenAt: number): { report: Submission; correction: Correction } | Refused {
  const report = who ? state.submissions.find((s) => s.id === id && mayWorkOn(s, who.userId, who.orgIds)) : undefined;
  if (report && who && !mayChange(report, who.userId, who.adminOf)) return { refused: OWNERS_ONLY };
  if (report?.status !== "live" || !report.correction) return { refused: "This report has no changes waiting any more. Reload to see where it stands." };
  // The changes on the screen the action came from, by when they were checked: ones sent since, say from another
  // tab, are never the ones discarded or asked about.
  if (report.correction.at !== seenAt) return { refused: "You changed the details again since this page loaded. Reload to see those changes." };
  return { report, correction: report.correction };
}

/**
 * The author of changes a check refused asks a person to look, with what they think the check got wrong. The
 * changes then wait for a reviewer, and the team's inbox hears of them.
 */
export async function requestCorrectionReview(id: string, seenAt: number, comment: string): Promise<Submission | Refused> {
  const who = await actor();
  const origin = await here();
  return change((state) => {
    const found = waitingChanges(state, id, who, seenAt);
    if ("refused" in found) return found;
    const { report, correction } = found;
    const stage = correctionStageOf(report, correction);
    if (stage === "declined") return { refused: "A reviewer declined these changes since this page loaded. Reload to see their note." };
    // Already with a reviewer: asking again tells no one anything new.
    if (stage === "review") return forAuthor(report);
    correction.request = { comment: comment.trim().slice(0, REVIEW_TEXT_MAX), at: Date.now() };
    mail(state, "changes-review-requested", report, origin);
    return forAuthor(touch(report, {}));
  });
}

/** The author gives up changes that haven't gone live. The report stays as it is. */
export async function discardCorrection(id: string, seenAt: number): Promise<Submission | Refused> {
  const who = await actor();
  return change((state) => {
    const found = waitingChanges(state, id, who, seenAt);
    // A run still reading changes is given up with them: its answers must not put anything live afterwards.
    return "refused" in found ? found : forAuthor(touch(found.report, { correction: undefined, run: undefined }));
  });
}

// Admin

/** A daily limit as kept: a whole number from 0, which stops someone starting any, to 1,000. */
const dailyLimit = (n: number) => Math.min(1000, Math.max(0, Math.round(Number.isFinite(n) ? n : 0)));

/** Openscholar's accounts and organisations for an admin to pick from, narrowed by what's typed. */
export async function findAccounts(query: string) {
  await requireAdmin();
  return accountsMatching(query.slice(0, 100));
}

/** Gives a person or an organisation a daily limit of their own, or changes the one they have. Clerk says who they are. */
export async function saveLimit({ kind, id, perDay }: { kind: LimitOverride["kind"]; id: string; perDay: number }): Promise<{ settings: Settings } | Refused> {
  await requireAdmin();
  const account = await accountOf(kind, id);
  if (!account) return { refused: kind === "person" ? "That account is no longer there." : "That organisation is no longer there." };
  return {
    settings: await change((state) => {
      const overrides = state.settings.limits.overrides;
      const at = overrides.findIndex((o) => o.id === id);
      // A changed limit keeps its place in the list; a new one goes last.
      // Only who and how many: their email and photo stay with Clerk.
      const entry = { kind: account.kind, id: account.id, name: account.name, perDay: dailyLimit(perDay) };
      state.settings.limits.overrides = at < 0 ? [...overrides, entry] : overrides.map((o, i) => (i === at ? entry : o));
      return state.settings;
    }),
  };
}

export async function removeLimit(id: string) {
  await requireAdmin();
  return change((state) => {
    state.settings.limits.overrides = state.settings.limits.overrides.filter((o) => o.id !== id);
    return state.settings;
  });
}

/** MOCK: the rail reads a cookie for whether Publish shows; the real build reads the setting. */
async function showInRail(settings: Settings) {
  const on = canPublish(settings);
  (await cookies()).set(OFF_COOKIE, on ? "" : "1", { path: "/", maxAge: on ? 0 : 60 * 60 * 24 * 365 });
}

export async function updateSettings(patch: Partial<Pick<Settings, "enabled" | "humanReview" | "metadataModel">> & { series?: Partial<Settings["series"]>; perDay?: number; orgPerDay?: number }) {
  await requireAdmin();
  const origin = await here();
  const settings = await change((state) => {
    const { series, perDay, orgPerDay, ...rest } = patch;
    const waited = state.submissions.filter((s) => stageOf(s, state.settings) === "review");
    Object.assign(state.settings, rest);
    if (perDay !== undefined) state.settings.limits.perDay = dailyLimit(perDay);
    if (orgPerDay !== undefined) state.settings.limits.orgPerDay = dailyLimit(orgPerDay);
    if (series) Object.assign(state.settings.series, series);
    // Review switched off releases what waited only for it. A report becomes its author's to activate (`stageOf`);
    // changes to a live report, which their author already sent, go live.
    if (!state.settings.humanReview) {
      for (const report of waited) if (stageOf(report, state.settings) === "ready") mail(state, "released", report, origin);
      for (const report of state.submissions) {
        const waiting = report.status === "live" ? report.correction : undefined;
        if (!waiting || waiting.declined || waiting.results.some((r) => !r.pass)) continue;
        applyCorrection(report, waiting);
        mail(state, "changes-live", report, origin);
      }
    }
    return state.settings;
  });
  await showInRail(settings);
  return settings;
}

/**
 * The Zenodo and Crossref accounts, saved by the form a community's settings use. One rule of a community's is
 * lifted: Crossref may be on without Zenodo, because Openscholar decides whether its reports are archived there.
 * A refusal comes back as words, not a throw, so it reaches the form.
 * MOCK: sandboxes only, and nothing is checked with Zenodo or Crossref. The real build verifies both and keeps the
 * credentials encrypted, as `publicationProviderActions.verifyAndSave` does for a community. That check already
 * sends Openscholar's User-Agent (#1186): zenodo.org answers 403 to Node's default `node`, and its sandbox doesn't,
 * so sandbox passing proves nothing about it. A community's deposits are new-el's worker's, which Zenodo accepts;
 * a report's will be Openscholar's own calls, and every one of them must send that User-Agent too.
 */
export async function savePublication(input: { settings: PublicationSettings; credentials: PublicationSecrets; expectedUpdatedAt: number | null }): Promise<{ settings: Settings } | Refused> {
  await requireAdmin();
  const settings = structuredClone(input.settings);
  if (settings.zenodo.mode === "custom" || settings.crossref.mode === "custom") return { refused: "Shared dev registers on the sandboxes only." };
  if (settings.crossref.mode === "sandbox") Object.assign(settings.crossref, CROSSREF_SANDBOX);
  settings.crossref.suffixNamespace = settings.crossref.suffixNamespace.trim().toLowerCase() || "openscholar-r";
  settings.zenodo.license = settings.zenodo.license.trim().toLowerCase();
  // Zenodo can archive under the Crossref DOI only while Crossref is on.
  if (settings.crossref.mode === "off") settings.zenodo.defaultIdentifierPolicy = "mint-zenodo";
  const saved = await change((state) => {
    if (state.settings.publicationSavedAt !== input.expectedUpdatedAt) return null;
    Object.assign(state.settings, { publication: settings, publicationSavedAt: Date.now() });
    return state.settings;
  });
  if (!saved) return { refused: "Publishing settings changed. Reload and try again." };
  await showInRail(saved);
  return { settings: saved };
}

/** A changed set of checks is a new version: reports keep the version they ran. */
function bump(state: MockState) {
  state.settings.checksVersion += 1;
  state.checkVersions[String(state.settings.checksVersion)] = structuredClone(state.settings.checks);
}

export async function saveCheck(check: Check) {
  await requireAdmin();
  return change((state) => {
    const at = state.settings.checks.findIndex((c) => c.id === check.id);
    if (at >= 0) state.settings.checks[at] = check;
    else state.settings.checks.push(check);
    bump(state);
    return state.settings;
  });
}

export async function removeCheck(id: string) {
  await requireAdmin();
  return change((state) => {
    state.settings.checks = state.settings.checks.filter((c) => c.id !== id);
    bump(state);
    return state.settings;
  });
}


export async function updateAgreement(text: string) {
  await requireAdmin();
  return change((state) => {
    // The text people signed stays with its version.
    state.agreementVersions = { ...state.agreementVersions, [String(state.settings.agreement.version)]: state.settings.agreement.text };
    state.settings.agreement = { ...state.settings.agreement, text, version: state.settings.agreement.version + 1, updatedAt: Date.now() };
    return state.settings;
  });
}

/**
 * The author of a report its checks failed asks a person to look, with what they think the checks got wrong. That
 * tells the team's inbox and shows the words to a reviewer, and nothing else: a reviewer can approve or decline any
 * report, asked or not. MOCK: the email is kept in the store, not sent.
 */
export async function requestReview(id: string, comment: string): Promise<Submission | Refused> {
  return answered(async () => {
    const who = await me();
    const origin = await here();
    return change((state) => {
      const report = reportOf(state, id, who);
      // Asked of a report its checks failed and no one has approved since: anything else has moved on.
      if (stageOf(report, state.settings) !== "failed") refuse(MOVED_ON);
      if (report.reviewRequest) return report;
      report.reviewRequest = { comment: comment.trim().slice(0, REVIEW_TEXT_MAX), at: Date.now() };
      mail(state, "review-requested", report, origin);
      return touch(report, {});
    });
  });
}

/**
 * A reviewer's word on any report, whatever its checks said and whether or not its author asked: approve one that
 * isn't live yet, so its author can activate it, or decline it. Declining a live report withdraws it: its page then
 * says it was withdrawn, since its DOI can't be removed. A withdrawn report can be reinstated, which makes it live again.
 */
export async function review(id: string, decision: "approve" | "decline" | "withdraw" | "reinstate", seenPdfAt: number | undefined, note?: string): Promise<Submission | Refused> {
  if (!(await isAdmin())) return NOT_ADMIN;
  const user = await currentUser();
  const origin = await here();
  // By name only: a reviewer's address never goes on a report its author reads.
  const by = user?.fullName || "A reviewer";
  // What stops a reviewer's word comes back in words: something changed since the report was opened.
  return change((state) => {
    const submission = state.submissions.find((s) => s.id === id);
    if (!submission || submission.step !== "done") return { refused: "This report isn't waiting on a reviewer any more. Reload to see where it stands." };
    // The word is on the PDF the reviewer had open: one uploaded since needs looking at again.
    if (submission.pdf?.at !== seenPdfAt) return { refused: "The author uploaded a new PDF since you opened this. Reload to review it." };
    const stage = stageOf(submission, state.settings);
    const said = note?.trim().slice(0, REVIEW_TEXT_MAX) || undefined;
    // Who decided what, and when, stays with the report; its author hears of it by email.
    const record = (decision: Review["decision"], event: MailEvent, patch: Partial<Submission>) => {
      touch(submission, { ...patch, reviews: [...(submission.reviews ?? []), { decision, by, at: Date.now(), ...(said && decision !== "approve" && decision !== "reinstate" ? { note: said } : {}) }] });
      mail(state, event, submission, origin);
      return submission;
    };
    if (decision === "reinstate") {
      if (stage !== "declined" || !submission.withdrawnAt) return { refused: "Only a withdrawn report can be reinstated." };
      return record("reinstate", "reinstated", { status: "live", withdrawnAt: undefined, note: undefined });
    }
    if (stage === "declined") return { refused: submission.withdrawnAt ? "This report was already withdrawn." : "This report was already declined." };
    // Withdrawing is a live report's and declining is one not yet live: a word given for the one never becomes the
    // other because the report went live, or was withdrawn, since the reviewer opened it.
    if (decision === "withdraw") {
      if (stage !== "live") return { refused: "This report isn't live. Reload to see where it stands." };
      return record("withdraw", "withdrawn", { status: "declined", withdrawnAt: Date.now(), note: said });
    }
    if (stage === "live") return { refused: "This report went live since you opened it. Reload to review it." };
    if (decision === "approve") {
      if (stage !== "failed" && stage !== "review") return { refused: "This report doesn't need approving any more. Its author can activate it." };
      // Approving lets the author activate it; the author decides when it goes live.
      return record("approve", "approved", { approved: true });
    }
    return record("decline", "declined", { status: "declined", note: said });
  });
}

/**
 * A reviewer's word on changes to a live report: approving puts them live and registers the report again, declining
 * keeps them for the author to change or discard. The report itself stays live either way. `seenAt` names the
 * changes the reviewer read, so changes the author has since replaced are never the ones decided.
 */
export async function reviewCorrection(id: string, decision: "approve" | "decline", seenAt: number, note?: string): Promise<Submission | Refused> {
  if (!(await isAdmin())) return NOT_ADMIN;
  const user = await currentUser();
  const origin = await here();
  const by = user?.fullName || "A reviewer";
  return change((state) => {
    const report = state.submissions.find((s) => s.id === id);
    const waiting = report?.status === "live" ? report.correction : undefined;
    if (!report || !waiting || waiting.declined) return { refused: "These changes aren't waiting any more. Reload to see where the report stands." };
    if (waiting.at !== seenAt) return { refused: "The author changed the details again since you opened this. Reload to review them." };
    const said = note?.trim().slice(0, REVIEW_TEXT_MAX) || undefined;
    if (decision === "approve") {
      applyCorrection(report, waiting);
      report.reviews = [...(report.reviews ?? []), { decision: "approve-changes", by, at: Date.now() }];
      mail(state, "changes-live", report, origin);
      return report;
    }
    waiting.declined = { at: Date.now(), ...(said ? { note: said } : {}) };
    touch(report, { reviews: [...(report.reviews ?? []), { decision: "decline-changes", by, at: Date.now(), ...(said ? { note: said } : {}) }] });
    mail(state, "changes-declined", report, origin);
    return report;
  });
}

/** The author makes a report live once no review is owed: its DOI is registered and its page opens. */
export async function activate(id: string): Promise<Submission | Refused> {
  return answered(async () => {
    const who = await me();
    const origin = await here();
    return change((state) => {
      const submission = reportOf(state, id, who);
      const stage: Stage = stageOf(submission, state.settings);
      if (stage === "live") refuse("This report is already live.");
      if (stage === "review") refuse("A reviewer has to approve this report before you can activate it.");
      if (stage !== "ready") refuse(MOVED_ON);
      // A DOI needs somewhere to register: with both registrars switched off, nothing goes live.
      if (!canRegister(state.settings)) refuse("Publishing is paused for now, so nothing can go live. Your report keeps its place.");
      const registers = providersOf(submission);
      touch(submission, { status: "live", activatedAt: Date.now(), archive: registers.includes("zenodo") ? "queued" : "none", deposit: registers.includes("crossref") ? "queued" : "none" });
      mail(state, "live", submission, origin);
      mail(state, "live-author", submission, origin);
      return submission;
    });
  });
}

/**
 * One of your reports as it stands now, with the one setting its stage is worked out from, so a page left open
 * follows both a reviewer's word and review being switched on or off. MOCK: the page asks again every few seconds;
 * the real build is told by Convex.
 */
export async function readReport(id: string) {
  const who = await actor();
  const state = await readState();
  const report = who ? state.submissions.find((s) => s.id === id && mayWorkOn(s, who.userId, who.orgIds)) : undefined;
  return report ? { report: forAuthor(report), humanReview: state.settings.humanReview } : null;
}

/**
 * MOCK: adds a live report to a community, or to its review queue. Nothing is sent: a sandbox DOI is registered
 * nowhere a community can look it up. The real build sends the DOI through `evidenceLibraries.assistant.addPapers`,
 * and the community asks Openscholar for the report before OpenAlex and the DOI's registrar.
 */
export async function addToCommunity(id: string, community: { id: string; name: string }, publish: boolean): Promise<{ outcome: "added" | "queued" | "existing"; report: Submission } | Refused> {
  return answered(async () => {
    const who = await me();
    return change((state) => {
      const report = reportOf(state, id, who);
      if (report.status !== "live") return refuse("This report isn't live any more, so it can't be added to a community.");
      report.communities ??= [];
      if (report.communities.some((c) => c.id === community.id)) return { outcome: "existing" as const, report };
      report.communities.push({ ...community, status: publish ? "published" : "queued" });
      return { outcome: publish ? ("added" as const) : ("queued" as const), report };
    });
  });
}

/**
 * A reviewer edits a checked report's details themselves, to fix what isn't worth sending back to its author. The
 * edit is the report's at once: a live report registers again, so Crossref and Zenodo hold it too. Who edited, and
 * when, stays on the report, and its author is told what changed. Not while the author's own changes are waiting:
 * those are approved or declined first, so neither set overwrites the other.
 */
export async function editDetails(id: string, seenAt: number, metadata: unknown): Promise<Submission | Refused> {
  if (!(await isAdmin())) return NOT_ADMIN;
  if (!isMetadata(metadata)) return { refused: "The report needs a title." };
  const user = await currentUser();
  const origin = await here();
  const by = user?.fullName || "A reviewer";
  return change((state) => {
    const report = state.submissions.find((s) => s.id === id);
    if (!report?.metadata || report.step !== "done") return { refused: "This report's details aren't a reviewer's to edit yet: its author is still working on it." };
    if (report.correction) return { refused: "The author's changes to this report are waiting. Approve or decline them first." };
    // The edit was made from the report as it stood when the form opened: one changed since, or being checked now,
    // is never overwritten by it.
    if (report.run) return { refused: "This report's checks are running on a change right now. Try again in a moment." };
    if (report.updatedAt !== seenAt) return { refused: "This report changed since you opened it. Reload to edit it as it stands." };
    const changed = changesOf(report.metadata, metadata).map((c) => c.label);
    if (JSON.stringify(report.metadata) === JSON.stringify(metadata)) return { refused: "Nothing was changed." };
    if (report.status === "live") applyCorrection(report, { metadata, results: report.results ?? [], checksVersion: report.checksVersion ?? state.settings.checksVersion });
    else touch(report, { metadata });
    report.reviews = [...(report.reviews ?? []), { decision: "edit", by, at: Date.now() }];
    mail(state, "details-edited", { ...report, note: changed.join(", ") }, origin);
    return report;
  });
}

export async function retryDeposit(id: string) {
  await requireAdmin();
  return change((state) => {
    const submission = state.submissions.find((s) => s.id === id);
    if (!submission) throw new Error("No such report.");
    // MOCK: the registration that was refused goes through this time.
    const failed = stepsOf(submission).find((step) => step.state === "failed")?.provider;
    // Nothing was refused: a row left open from earlier has nothing to send again.
    if (!failed) return submission;
    return touch(submission, failed === "zenodo" ? { archive: "archived" } : { deposit: "deposited" });
  });
}
