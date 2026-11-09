"use server";
// MOCK (mock/publish-reports): the Publish flow and its admin page, against the mock's local store. The real build
// makes these Convex functions with their user-action registry entries.
import { mkdir, writeFile } from "node:fs/promises";
import { cookies } from "next/headers";
import { currentUser } from "@clerk/nextjs/server";
import { extractPdfJsTextPages } from "@/convex/extraction/pdfjs_extract";
import { searchOpenAlex } from "@/lib/openalex/lookup";
import { countriesIn, countryOfPlace, doisIn, fundingIn, keywordsFrom, linksIn, suggestDesigns, suggestSdgs } from "@/lib/publish-mock/read";
import { suggestTopics } from "@/lib/publish-mock/topics";
import { MOCK_DIR, nextKey, pdfPath, readState, writeState } from "@/lib/publish-mock/store";
import { doiOf, type Affiliation, type Check, type Metadata, type MockState, type Settings, type Step, type Submission } from "@/lib/publish-mock/types";

/** The rail reads this to leave Publish out while the admin page has it off. */
const OFF_COOKIE = "os-publish-off";

async function change<T>(edit: (state: MockState) => T | Promise<T>) {
  const state = await readState();
  const out = await edit(state);
  await writeState(state);
  return out;
}

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
  const draft: Submission = { id, doi: doiOf(state.settings, id), step: "agreement", status: "draft", deposit: "none", createdAt: Date.now(), updatedAt: Date.now() };
  state.submissions.unshift(draft);
  state.draftId = id;
  return draft;
}

export async function signAgreement({ name, onBehalfOfAll }: { name: string; onBehalfOfAll: boolean }) {
  const user = await currentUser();
  return change((state) =>
    touch(openDraft(state), {
      ...(user ? { ownerId: user.id } : {}),
      signedBy: { name: name.trim(), email: user?.primaryEmailAddress?.emailAddress ?? "", onBehalfOfAll },
      signedAt: Date.now(),
      agreementVersion: state.settings.agreement.version,
      // Signing reserves the DOI: it's the report's from now on, and goes live when the report passes its checks.
      doi: doiOf(state.settings, state.draftId!),
      step: "doi",
    }),
  );
}

/** Back to a step already done, or on to the next one the report is ready for. */
export async function goTo(step: Step) {
  return change((state) => touch(draftOf(state), { step }));
}

/** MOCK: the affiliation as OpenAlex knows it, with its country; as written when OpenAlex has no match or can't be asked. */
async function matchInstitution(name: string): Promise<Affiliation> {
  try {
    const [best] = await searchOpenAlex("institutions", name);
    if (best) return { id: best.id, name: best.name, country: countryOfPlace(best.detail) };
  } catch (error) {
    console.error("[publish mock] institution lookup failed", error);
  }
  return { id: null, name, country: "" };
}

type Page = { items: Array<{ str: string; hasEOL?: boolean }> };
/** A page's text with its line breaks, which the extractor's joined text drops. */
const linesOf = (page: Page | undefined) =>
  (page?.items ?? []).map((item) => item.str + (item.hasEOL ? "\n" : "")).join("").split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);

/** MOCK: what the metadata model would read. The title is the first line that reads like one; under it, "Name, Affiliation". */
function readDetails(pages: Page[], file: string, signer: string) {
  const lines = linesOf(pages[0]);
  const at = lines.findIndex((l) => l.length > 12 && l.length < 200 && !/^(this publication|doi|https?:)/i.test(l));
  const title = at >= 0 ? lines[at]! : file.replace(/\.pdf$/i, "").replace(/[-_]+/g, " ");
  const byline = at >= 0 ? lines[at + 1]?.match(/^([^,]{3,60}),\s*(.{3,120})$/) : null;
  const all = pages.slice(0, 3).flatMap((page) => linesOf(page));
  const start = all.findIndex((l) => /^abstract\b/i.test(l));
  const body = start >= 0 ? all.slice(start + 1) : all.slice(at + 1);
  // It ends where the first numbered section starts.
  const end = body.findIndex((l) => /^\d+\.?\s+\p{Lu}/u.test(l));
  const abstract = (end >= 0 ? body.slice(0, end) : body).join(" ").replace(/^abstract\s*/i, "");
  // A long one is cut at a word, near 900 characters.
  const cut = abstract.length > 900 ? abstract.slice(0, 900).replace(/\s\S*$/, "") : abstract;
  return { title, abstract: cut, author: byline ? { name: byline[1]!.trim(), affiliation: byline[2]!.trim() } : { name: signer, affiliation: "" } };
}

/** The PDF, kept with the report, and its details as the metadata model reads them. */
export async function uploadPdf(form: FormData) {
  const file = form.get("pdf");
  if (!(file instanceof File) || !/\.pdf$/i.test(file.name)) throw new Error("Choose a PDF.");
  const bytes = await file.arrayBuffer();
  // pdfjs takes its buffer over, so it reads a copy and the original is kept.
  const { pages, totalPages } = await extractPdfJsTextPages(bytes.slice(0));
  const user = await currentUser();
  return change(async (state) => {
    const draft = draftOf(state);
    await mkdir(MOCK_DIR, { recursive: true });
    await writeFile(pdfPath(draft.id), Buffer.from(bytes));
    const read = readDetails(pages, file.name, draft.signedBy?.name || user?.fullName || "");
    const full = pages.map((page) => linesOf(page).join("\n")).join("\n");
    const about = `${read.title}\n${read.abstract}`;
    const affiliation = read.author.affiliation ? await matchInstitution(read.author.affiliation) : null;
    const named = countriesIn(about);
    const metadata: Metadata = {
      title: read.title,
      subtitle: "",
      type: "report",
      language: "en",
      date: new Date().toISOString().slice(0, 10),
      licence: "CC BY 4.0",
      authors: [{ name: read.author.name, orcid: "", openalexId: null, affiliations: affiliation ? [affiliation] : [], corresponding: true, roles: [] }],
      abstract: read.abstract,
      // OpenAlex matches every word searched, so the title alone finds the works most like it.
      topics: await suggestTopics(read.title),
      keywords: keywordsFrom(about),
      sdgs: suggestSdgs(about),
      studyDesigns: suggestDesigns(full),
      countries: named.length ? named : countriesIn(full).slice(0, 3),
      funding: fundingIn(full),
      references: doisIn(full, draft.doi),
      relations: linksIn(full),
    };
    // MOCK: the text the checks read, kept beside the PDF.
    await writeFile(pdfPath(draft.id).replace(/\.pdf$/, ".txt"), pages.map((p) => p.text).join("\n"));
    return touch(draft, { pdf: { name: file.name, pages: totalPages, bytes: file.size }, metadata, step: "details" });
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

export async function updateSettings(patch: Partial<Pick<Settings, "enabled" | "humanReview" | "crossref" | "metadataModel">> & { series?: Partial<Settings["series"]> }) {
  if (patch.enabled !== undefined) (await cookies()).set(OFF_COOKIE, patch.enabled ? "" : "1", { path: "/", maxAge: patch.enabled ? 0 : 60 * 60 * 24 * 365 });
  return change((state) => {
    const { series, ...rest } = patch;
    Object.assign(state.settings, rest);
    if (series) Object.assign(state.settings.series, series);
    return state.settings;
  });
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
    return touch(submission, decision === "approve" ? { status: "live", deposit: "queued" } : { status: "declined", ...(note ? { note } : {}) });
  });
}

export async function retryDeposit(id: string) {
  return change((state) => {
    const submission = state.submissions.find((s) => s.id === id);
    if (!submission) throw new Error("No such report.");
    return touch(submission, { deposit: "deposited" });
  });
}
