"use server";
// MOCK (mock/publish-reports): the Publish flow and its admin page, against the mock's local store. The real build
// makes these Convex functions with their user-action registry entries.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cookies } from "next/headers";
import { currentUser } from "@clerk/nextjs/server";
import { extractPdfJsTextPages } from "@/convex/extraction/pdfjs_extract";
import { readDetails } from "@/lib/publish-mock/reader";
import type { PublicationSecrets, PublicationSettings } from "@/convex/evidenceLibraries/publicationValidators";
import { renderCover } from "@/lib/publish-mock/cover";
import { CROSSREF_SANDBOX, MOCK_DIR, changeState, coverPath, nextKey, pdfPath, readState, textPath } from "@/lib/publish-mock/store";
import { canPublish, doiOf, providersOf, registrationOf, stageOf, stepsOf, type Check, type Metadata, type MockState, type Settings, type Step, type Submission } from "@/lib/publish-mock/types";

/** The rail reads this to leave Publish out while the admin page has it off. */
const OFF_COOKIE = "os-publish-off";

const change = changeState;

function draftOf(state: MockState) {
  const draft = state.submissions.find((s) => s.id === state.draftId);
  if (!draft) throw new Error("No report is being published.");
  return draft;
}

function touch(submission: Submission, patch: Partial<Submission>) {
  Object.assign(submission, patch, { updatedAt: Date.now() });
  return submission;
}

/** The report being published, made when there's none: signing the agreement starts one. */
function openDraft(state: MockState) {
  const open = state.submissions.find((s) => s.id === state.draftId);
  if (open && open.step !== "done") return open;
  const id = nextKey(state);
  const draft: Submission = { id, doi: doiOf(state.settings, id), step: "agreement", status: "draft", deposit: "none", archive: "none", createdAt: Date.now(), updatedAt: Date.now() };
  state.submissions.unshift(draft);
  state.draftId = id;
  return draft;
}

export async function signAgreement({ name, onBehalfOfAll }: { name: string; onBehalfOfAll: boolean }) {
  const user = await currentUser();
  return change((state) => {
    if (!canPublish(state.settings)) throw new Error("Publishing is off until Crossref or Zenodo is connected.");
    const registration = registrationOf(state.settings);
    const draft = openDraft(state);
    // Signed once: a second signing, say from a tab left open, never moves a reserved DOI or its route.
    if (draft.step !== "agreement") return draft;
    return touch(draft, {
      ...(user ? { ownerId: user.id } : {}),
      signedBy: { name: name.trim(), email: user?.primaryEmailAddress?.emailAddress ?? "", onBehalfOfAll },
      signedAt: Date.now(),
      agreementVersion: state.settings.agreement.version,
      // Signing reserves the DOI: it's the report's from now on, and goes live when the report is activated. How
      // the report registers is fixed with it. With Zenodo on, Zenodo holds a draft for the file from here, as for
      // a community's record.
      doi: doiOf(state.settings, state.draftId!),
      registration,
      archive: registration.zenodo ? "draft" : "none",
      step: "doi",
    });
  });
}

/** Back to a step already done, or on to the next one the report is ready for. */
export async function goTo(step: Step) {
  return change((state) => {
    const draft = draftOf(state);
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
  const [{ pages, totalPages }, cover] = await Promise.all([
    extractPdfJsTextPages(bytes.slice(0)),
    renderCover(bytes.slice(0)).catch((error: unknown) => {
      console.error("[publish mock] cover not drawn", String(error));
      return null;
    }),
  ]);
  return change(async (state) => {
    const draft = draftOf(state);
    if (draft.step === "done") throw new Error("This report has been checked. Start another to publish a new PDF.");
    await mkdir(MOCK_DIR, { recursive: true });
    await writeFile(pdfPath(draft.id), Buffer.from(bytes));
    if (cover) await writeFile(coverPath(draft.id), cover);
    // The text the model falls back to and the checks read, kept beside the PDF.
    await writeFile(textPath(draft.id), pages.map((p) => p.text).join("\n"));
    const at = Date.now();
    return touch(draft, { pdf: { name: file.name, pages: totalPages, bytes: file.size, at }, run: undefined, cover: cover ? at : undefined });
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
    return { draft: touch(draft, { metadata: details, step: "details" }), read: metadata !== null };
  });
}

/** One of your reports, made the one the Publish page shows: a draft or a failed one carries on from where it stopped. */
export async function openReport(id: string) {
  const user = await currentUser();
  return change((state) => {
    const report = state.submissions.find((s) => s.id === id && (s.demo || (user && s.ownerId === user.id)));
    if (!report) throw new Error("No such report of yours.");
    state.draftId = id;
    return report;
  });
}

/** Starts a new report after one that's done. */
export async function startOver() {
  await change((state) => {
    state.draftId = null;
  });
}

// Admin

/** MOCK: the rail reads a cookie for whether Publish shows; the real build reads the setting. */
async function showInRail(settings: Settings) {
  const on = canPublish(settings);
  (await cookies()).set(OFF_COOKIE, on ? "" : "1", { path: "/", maxAge: on ? 0 : 60 * 60 * 24 * 365 });
}

export async function updateSettings(patch: Partial<Pick<Settings, "enabled" | "humanReview" | "metadataModel">> & { series?: Partial<Settings["series"]> }) {
  const settings = await change((state) => {
    const { series, ...rest } = patch;
    Object.assign(state.settings, rest);
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
  return change((state) => {
    const at = state.settings.checks.findIndex((c) => c.id === check.id);
    if (at >= 0) state.settings.checks[at] = check;
    else state.settings.checks.push(check);
    bump(state);
    return state.settings;
  });
}

export async function removeCheck(id: string) {
  return change((state) => {
    state.settings.checks = state.settings.checks.filter((c) => c.id !== id);
    bump(state);
    return state.settings;
  });
}


export async function updateAgreement(text: string) {
  return change((state) => {
    // The text people signed stays with its version.
    state.agreementVersions = { ...state.agreementVersions, [String(state.settings.agreement.version)]: state.settings.agreement.text };
    state.settings.agreement = { ...state.settings.agreement, text, version: state.settings.agreement.version + 1, updatedAt: Date.now() };
    return state.settings;
  });
}

export async function review(id: string, decision: "approve" | "decline", note?: string) {
  return change((state) => {
    const submission = state.submissions.find((s) => s.id === id);
    if (!submission) throw new Error("No such report.");
    if (submission.status !== "passed") throw new Error("Only a report that passed its checks can be reviewed.");
    // Approving lets the author activate it; the author decides when it goes live.
    return touch(submission, decision === "approve" ? { approved: true } : { status: "declined", ...(note ? { note } : {}) });
  });
}

/** The author makes a passed report live: its DOI goes to Crossref and its page opens. Only once no review is owed. */
export async function activate(id: string) {
  const user = await currentUser();
  return change((state) => {
    const submission = state.submissions.find((s) => s.id === id && (s.demo || (user && s.ownerId === user.id)));
    if (!submission) throw new Error("No such report of yours.");
    if (submission.step !== "done" || stageOf(submission, state.settings) !== "ready") throw new Error("A reviewer approves this report before you can activate it.");
    const registers = providersOf(submission);
    return touch(submission, { status: "live", activatedAt: Date.now(), archive: registers.includes("zenodo") ? "queued" : "none", deposit: registers.includes("crossref") ? "queued" : "none" });
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
  return change((state) => {
    const submission = state.submissions.find((s) => s.id === id);
    if (!submission) throw new Error("No such report.");
    // MOCK: the registration that was refused goes through this time.
    const failed = stepsOf(submission).find((step) => step.state === "failed")?.provider;
    return touch(submission, failed === "zenodo" ? { archive: "archived" } : { deposit: "deposited" });
  });
}
