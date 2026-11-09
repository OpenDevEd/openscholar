"use server";
// MOCK (mock/publish-reports): the Publish flow and its admin page, against the mock's local store. The real build
// makes these Convex functions with their user-action registry entries.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { cookies, headers } from "next/headers";
import { auth, currentUser } from "@clerk/nextjs/server";
import { extractPdfJsTextPages } from "@/convex/extraction/pdfjs_extract";
import { accountOf, accountsMatching, organizationsOf, requireAdmin } from "@/lib/publish-mock/admin";
import { mail, type MailEvent } from "@/lib/publish-mock/emails";
import { readDetails } from "@/lib/publish-mock/reader";
import type { PublicationSecrets, PublicationSettings } from "@/convex/evidenceLibraries/publicationValidators";
import { renderCover } from "@/lib/publish-mock/cover";
import { CROSSREF_SANDBOX, MOCK_DIR, changeState, coverPath, nextKey, pdfPath, readState, textPath } from "@/lib/publish-mock/store";
import { REVIEW_TEXT_MAX, canPublish, isMetadata, limitFor, startsLeft, doiOf, providersOf, registrationOf, stageOf, stepsOf, type Check, type LimitOverride, type Metadata, type Review, type MockState, type Settings, type Step, type Submission } from "@/lib/publish-mock/types";

/** The rail reads this to leave Publish out while the admin page has it off. */
const OFF_COOKIE = "os-publish-off";

const change = changeState;

/** Who is acting. Each person has a report of their own open, so every step needs to know whose it is. */
async function me() {
  const { userId } = await auth();
  if (!userId) throw new Error("Sign in to publish.");
  return userId;
}

/** The report this person has open on the Publish page. */
function draftOf(state: MockState, userId: string) {
  const draft = state.submissions.find((s) => s.id === state.drafts[userId]);
  if (!draft) throw new Error("No report is being published.");
  return draft;
}

function touch(submission: Submission, patch: Partial<Submission>) {
  Object.assign(submission, patch, { updatedAt: Date.now() });
  return submission;
}

/** The report this person is publishing, made when they have none open: signing the agreement starts one. */
function openDraft(state: MockState, userId: string) {
  const open = state.submissions.find((s) => s.id === state.drafts[userId]);
  if (open && open.step !== "done") return open;
  const id = nextKey(state);
  const draft: Submission = { id, ownerId: userId, doi: doiOf(state.settings, id), step: "agreement", status: "draft", deposit: "none", archive: "none", createdAt: Date.now(), updatedAt: Date.now() };
  state.submissions.unshift(draft);
  state.drafts[userId] = id;
  return draft;
}

/**
 * Signs the agreement, which starts the person's report and reserves its DOI. A person may start only so many a
 * day (`limitFor`): past that the signing is refused, in words, since a built server hides what an action throws.
 */
export async function signAgreement({ name, onBehalfOfAll }: { name: string; onBehalfOfAll: boolean }): Promise<{ draft: Submission } | { refused: string }> {
  const user = await currentUser();
  if (!user) return { refused: "Sign in to publish." };
  const orgIds = await organizationsOf(user.id);
  return change((state) => {
    if (!canPublish(state.settings)) return { refused: "Publishing is off for now." };
    const open = state.submissions.find((s) => s.id === state.drafts[user.id]);
    const starting = !open || open.step === "done";
    if (starting && startsLeft(state, user.id, orgIds) < 1) {
      const perDay = limitFor(state.settings, user.id, orgIds);
      return { refused: perDay === 0 ? "Publishing isn't open to your account yet." : `You can start ${perDay} ${perDay === 1 ? "report" : "reports"} a day. Come back tomorrow.` };
    }
    const registration = registrationOf(state.settings);
    const draft = openDraft(state, user.id);
    // Signed once: a second signing, say from a tab left open, never moves a reserved DOI or its route.
    if (draft.step !== "agreement") return { draft };
    // Counted where it can't be undone: a report discarded later still used one of the day's starts.
    if (starting) state.started = { ...state.started, [user.id]: [...(state.started?.[user.id] ?? []).filter((at) => Date.now() - at < 24 * 60 * 60 * 1000), Date.now()] };
    touch(draft, {
      signedBy: { name: name.trim(), email: user.primaryEmailAddress?.emailAddress ?? "", onBehalfOfAll },
      signedAt: Date.now(),
      agreementVersion: state.settings.agreement.version,
      // Signing reserves the DOI: it's the report's from now on, and goes live when the report is activated. How
      // the report registers is fixed with it. With Zenodo on, Zenodo holds a draft for the file from here, as for
      // a community's record.
      doi: doiOf(state.settings, draft.id),
      registration,
      archive: registration.zenodo ? "draft" : "none",
      step: "doi",
    });
    return { draft };
  });
}

/** The author's corrections, kept as they make them, so leaving the details step loses nothing. */
export async function saveDetails(id: string, metadata: unknown) {
  const userId = await me();
  if (!isMetadata(metadata)) throw new Error("The report's details are missing.");
  await change((state) => {
    const draft = state.submissions.find((s) => s.id === id && (s.demo || s.ownerId === userId));
    // Only while the details are being corrected: a save that arrives after the checks started changes nothing.
    if (draft?.step === "details" && !draft.run) touch(draft, { metadata });
  });
}

/** Gives up a report that was never checked: it, its PDF and its reserved DOI are gone. The day's start it used stays used. */
export async function discardReport(id: string) {
  const userId = await me();
  await change(async (state) => {
    const report = state.submissions.find((s) => s.id === id && s.ownerId === userId);
    if (!report) throw new Error("No such report of yours.");
    if (report.status !== "draft") throw new Error("Only a report that hasn't been checked can be discarded.");
    state.submissions = state.submissions.filter((s) => s !== report);
    if (state.drafts[userId] === id) delete state.drafts[userId];
    await Promise.all([pdfPath(id), coverPath(id), textPath(id)].map((file) => rm(file, { force: true })));
  });
}

/** Back to a step already done, or on to the next one the report is ready for. */
export async function goTo(step: Step) {
  const userId = await me();
  return change((state) => {
    const draft = draftOf(state, userId);
    // A report past its checks goes back only to replace a PDF that failed them: one that passed or is live stays as checked.
    if (draft.step === "done" && draft.status !== "failed") throw new Error("This report has been checked. Start another to publish a new PDF.");
    return touch(draft, { step });
  });
}

/** The PDF, kept with the report with its text and a picture of its first page. Its details are read next (`readPdfDetails`). */
export async function uploadPdf(form: FormData) {
  const file = form.get("pdf");
  if (!(file instanceof File) || !/\.pdf$/i.test(file.name)) throw new Error("Choose a PDF.");
  const bytes = await file.arrayBuffer();
  // pdfjs takes its buffer over, so each reader gets a copy and the original is kept.
  // The text and the cover are read side by side. A first page that can't be drawn leaves the report its title page.
  const userId = await me();
  const origin = (await headers()).get("origin") ?? "";
  const opened = await Promise.all([
    extractPdfJsTextPages(bytes.slice(0)),
    renderCover(bytes.slice(0)).catch((error: unknown) => {
      console.error("[publish mock] cover not drawn", String(error));
      return null;
    }),
  ]).catch(async (error: unknown) => {
    // A file that isn't a PDF pdf.js can open: the team's inbox hears of it, and the author is told to try another.
    console.error("[publish mock] the PDF couldn't be opened", { name: file.name, bytes: file.size, error: String(error).slice(0, 300) });
    await change((state) => mail(state, "pdf-unread", { ...draftOf(state, userId), pdf: { name: file.name, pages: 0, bytes: file.size } }, origin));
    return null;
  });
  if (!opened) throw new Error("This PDF couldn't be opened. Try saving it again as a PDF.");
  const [{ pages, totalPages }, cover] = opened;
  return change(async (state) => {
    const draft = draftOf(state, userId);
    if (draft.step === "done") throw new Error("This report has been checked. Start another to publish a new PDF.");
    await mkdir(MOCK_DIR, { recursive: true });
    await writeFile(pdfPath(draft.id), Buffer.from(bytes));
    if (cover) await writeFile(coverPath(draft.id), cover);
    // The text the model falls back to and the checks read, kept beside the PDF.
    await writeFile(textPath(draft.id), pages.map((p) => p.text).join("\n"));
    const at = Date.now();
    // A new PDF starts over: the details read from the one before it are gone until this one is read.
    return touch(draft, { pdf: { name: file.name, pages: totalPages, bytes: file.size, at }, run: undefined, cover: cover ? at : undefined, step: "upload", metadata: undefined, reviewRequest: undefined, approved: undefined });
  });
}

/**
 * The stored PDF's details, read by the model set on the admin page, with topics from OpenAlex's classifier and
 * affiliations and funders matched to OpenAlex (lib/publish-mock/reader.ts). The report then waits at its details for
 * its author to correct them. `read` is false when the model couldn't read the PDF: the details are then left for
 * the author to fill in.
 */
export async function readPdfDetails(id: string): Promise<{ draft: Submission; read: boolean }> {
  const user = await currentUser();
  const origin = (await headers()).get("origin") ?? "";
  const state = await readState();
  const report = state.submissions.find((s) => s.id === id && (s.demo || (user && s.ownerId === user.id)));
  if (!report?.pdf || report.step === "done") throw new Error("This report has no PDF waiting to be read.");
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
    if (!draft?.pdf || draft.pdf.at !== at || draft.step === "done") throw new Error("A newer PDF replaced the one being read.");
    touch(draft, { metadata: details, step: "details" });
    if (!metadata) mail(state, "pdf-unread", draft, origin);
    return { draft, read: metadata !== null };
  });
}

/** One of your reports, made the one the Publish page shows: a draft or a failed one carries on from where it stopped. */
export async function openReport(id: string) {
  const user = await currentUser();
  return change((state) => {
    const report = state.submissions.find((s) => s.id === id && (s.demo || (user && s.ownerId === user.id)));
    if (!user || !report) throw new Error("No such report of yours.");
    state.drafts[user.id] = id;
    return report;
  });
}

/** Starts a new report after one that's done. */
export async function startOver() {
  const userId = await me();
  await change((state) => {
    delete state.drafts[userId];
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
export async function saveLimit({ kind, id, perDay }: { kind: LimitOverride["kind"]; id: string; perDay: number }): Promise<{ settings: Settings } | { refused: string }> {
  await requireAdmin();
  const account = await accountOf(kind, id);
  if (!account) return { refused: kind === "person" ? "That account is no longer there." : "That organisation is no longer there." };
  return {
    settings: await change((state) => {
      const overrides = state.settings.limits.overrides;
      const at = overrides.findIndex((o) => o.id === id);
      // A changed limit keeps its place in the list; a new one goes last.
      const entry = { ...account, perDay: dailyLimit(perDay) };
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

export async function updateSettings(patch: Partial<Pick<Settings, "enabled" | "humanReview" | "metadataModel">> & { series?: Partial<Settings["series"]>; perDay?: number }) {
  await requireAdmin();
  const settings = await change((state) => {
    const { series, perDay, ...rest } = patch;
    Object.assign(state.settings, rest);
    if (perDay !== undefined) state.settings.limits.perDay = dailyLimit(perDay);
    if (series) Object.assign(state.settings.series, series);
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
 * credentials encrypted, as `publicationProviderActions.verifyAndSave` does for a community.
 */
export async function savePublication(input: { settings: PublicationSettings; credentials: PublicationSecrets; expectedUpdatedAt: number | null }): Promise<{ settings: Settings } | { refused: string }> {
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
export async function requestReview(id: string, comment: string) {
  const user = await currentUser();
  const origin = (await headers()).get("origin") ?? "";
  return change((state) => {
    const report = user ? state.submissions.find((s) => s.id === id && (s.demo || s.ownerId === user.id)) : undefined;
    if (!report) throw new Error("No such report of yours.");
    if (report.status !== "failed" || report.step !== "done") throw new Error("Only a report its checks failed can be sent for review.");
    if (report.reviewRequest) return report;
    report.reviewRequest = { comment: comment.trim().slice(0, REVIEW_TEXT_MAX), at: Date.now() };
    mail(state, "review-requested", report, origin);
    return touch(report, {});
  });
}

/**
 * A reviewer's word on any report, whatever its checks said and whether or not its author asked: approve one that
 * isn't live yet, so its author can activate it, or decline it. Declining a live report withdraws it: its page then
 * says it was withdrawn, since its DOI can't be removed. A withdrawn report can be reinstated, which makes it live again.
 */
export async function review(id: string, decision: "approve" | "decline" | "reinstate", seenPdfAt: number | undefined, note?: string) {
  await requireAdmin();
  const user = await currentUser();
  const origin = (await headers()).get("origin") ?? "";
  const by = user?.fullName || user?.primaryEmailAddress?.emailAddress || "A reviewer";
  return change((state) => {
    const submission = state.submissions.find((s) => s.id === id);
    if (!submission || submission.step !== "done") throw new Error("No such report to review.");
    // The word is on the PDF the reviewer had open: one uploaded since needs looking at again.
    if (submission.pdf?.at !== seenPdfAt) throw new Error("The author uploaded a new PDF since you opened this. Reload to review it.");
    const stage = stageOf(submission, state.settings);
    const said = note?.trim().slice(0, REVIEW_TEXT_MAX) || undefined;
    // Who decided what, and when, stays with the report; its author hears of it by email.
    const record = (decision: Review["decision"], event: MailEvent, patch: Partial<Submission>) => {
      touch(submission, { ...patch, reviews: [...(submission.reviews ?? []), { decision, by, at: Date.now(), ...(said && decision !== "approve" && decision !== "reinstate" ? { note: said } : {}) }] });
      mail(state, event, submission, origin);
      return submission;
    };
    if (decision === "reinstate") {
      if (stage !== "declined" || !submission.withdrawnAt) throw new Error("Only a withdrawn report can be reinstated.");
      return record("reinstate", "reinstated", { status: "live", withdrawnAt: undefined, note: undefined });
    }
    if (stage === "declined") throw new Error("This report was already declined.");
    if (decision === "approve") {
      if (stage !== "failed" && stage !== "review") throw new Error("This report doesn't need approving.");
      // Approving lets the author activate it; the author decides when it goes live.
      return record("approve", "approved", { approved: true });
    }
    return stage === "live"
      ? record("withdraw", "withdrawn", { status: "declined", withdrawnAt: Date.now(), note: said })
      : record("decline", "declined", { status: "declined", note: said });
  });
}

/** The author makes a passed report live: its DOI goes to Crossref and its page opens. Only once no review is owed. */
export async function activate(id: string) {
  const user = await currentUser();
  const origin = (await headers()).get("origin") ?? "";
  return change((state) => {
    const submission = state.submissions.find((s) => s.id === id && (s.demo || (user && s.ownerId === user.id)));
    if (!submission) throw new Error("No such report of yours.");
    if (submission.step !== "done" || stageOf(submission, state.settings) !== "ready") throw new Error("A reviewer approves this report before you can activate it.");
    const registers = providersOf(submission);
    touch(submission, { status: "live", activatedAt: Date.now(), archive: registers.includes("zenodo") ? "queued" : "none", deposit: registers.includes("crossref") ? "queued" : "none" });
    mail(state, "live", submission, origin);
    mail(state, "live-author", submission, origin);
    return submission;
  });
}

/** One of your reports as it stands now. MOCK: the live page asks again while a registration is under way; the
 * real build is told by Convex. */
export async function readReport(id: string) {
  const user = await currentUser();
  const state = await readState();
  return state.submissions.find((s) => s.id === id && (s.demo || (user && s.ownerId === user.id))) ?? null;
}

/**
 * MOCK: adds a live report to a community, or to its review queue. Nothing is sent: a sandbox DOI is registered
 * nowhere a community can look it up. The real build sends the DOI through `evidenceLibraries.assistant.addPapers`,
 * and the community asks Openscholar for the report before OpenAlex and the DOI's registrar.
 */
export async function addToCommunity(id: string, community: { id: string; name: string }, publish: boolean): Promise<{ outcome: "added" | "queued" | "existing"; report: Submission }> {
  const user = await currentUser();
  return change((state) => {
    const report = state.submissions.find((s) => s.id === id && (s.demo || (user && s.ownerId === user.id)));
    if (!report || report.status !== "live") throw new Error("Only a live report of yours can be added to a community.");
    report.communities ??= [];
    if (report.communities.some((c) => c.id === community.id)) return { outcome: "existing", report };
    report.communities.push({ ...community, status: publish ? "published" : "queued" });
    return { outcome: publish ? "added" : "queued", report };
  });
}

export async function retryDeposit(id: string) {
  await requireAdmin();
  return change((state) => {
    const submission = state.submissions.find((s) => s.id === id);
    if (!submission) throw new Error("No such report.");
    // MOCK: the registration that was refused goes through this time.
    const failed = stepsOf(submission).find((step) => step.state === "failed")?.provider;
    return touch(submission, failed === "zenodo" ? { archive: "archived" } : { deposit: "deposited" });
  });
}
