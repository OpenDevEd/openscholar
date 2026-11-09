// MOCK (mock/publish-reports): running a report's checks. The route at /publish/checks streams each check's answer as
// it comes; the last step saves them and decides what happens to the report.
import { readFile } from "node:fs/promises";
import { alreadyPublished } from "./published";
import { pdfPath, readState, writeState } from "./store";
import { bylineOf, isPassFail, type Check, type CheckResult, type Metadata, type Settings, type Submission } from "./types";

const squash = (text: string) => text.toLowerCase().replace(/\s+/g, "");

/** Whether a score clears a check: at least its threshold, or for scores that must stay low, at most it. */
const passes = (score: number, check: Check) => (check.direction === "atMost" ? score <= check.threshold : score >= check.threshold);

/** MOCK: each check's answer. Text match really reads the PDF's text; the others are made up from the file's name. */
export async function runCheck(check: Check, settings: Settings, draft: Submission, text: string, metadata: Metadata): Promise<CheckResult> {
  const base = { checkId: check.id, name: check.name, engine: check.engine, threshold: check.threshold, direction: check.direction, blocking: check.blocking, ...(isPassFail(check) ? { passFail: true } : {}) };
  const name = draft.pdf?.name.toLowerCase() ?? "";
  if (check.engine === "llm") {
    const score = name.includes("advert") ? 0.22 : 0.93;
    const research = score >= 0.5;
    return {
      ...base,
      score,
      pass: passes(score, check),
      reasoning: research
        ? "A study with a question, a method and findings. It names no product and links only to its own data."
        : "Most pages describe a paid training course and link to its sign-up page; the study itself is two pages long.",
    };
  }
  let score = 0.01;
  // The text to find, with {byline} as this report's. Wrapping and line breaks in the PDF don't count.
  if (check.decisionModel === "text-match") {
    score = squash(text).includes(squash(check.instructions.replaceAll("{byline}", bylineOf(settings, draft.doi)))) ? 1 : 0;
    return { ...base, score, pass: score === 1, detail: score === 1 ? "The PDF carries the byline with its DOI." : "The PDF doesn't carry the byline with its DOI." };
  } else if (check.decisionModel === "already-published") {
    // The check compares candidates with the model the admin page sets for reading reports.
    const found = await alreadyPublished(metadata, settings.metadataModel);
    return found
      ? { ...base, score: 1, pass: false, evidence: { title: found.title, url: found.url, where: found.where }, ...(found.reason ? { reasoning: found.reason } : {}) }
      : { ...base, score: 0, pass: true, detail: "Not in OpenAlex, Openscholar's index or our communities." };
  } else if (check.decisionModel === "language-id") score = 0.98;
  return { ...base, score, pass: passes(score, check) };
}

/** The checks that are on now, and the text they read, for the report being published. */
export async function checksFor(draftId: string) {
  const state = await readState();
  const draft = state.submissions.find((s) => s.id === draftId);
  if (!draft) throw new Error("No report is being published.");
  const text = await readFile(pdfPath(draft.id).replace(/\.pdf$/, ".txt"), "utf8").catch(() => "");
  return { settings: state.settings, draft, text, checks: state.settings.checks.filter((c) => c.enabled) };
}

/** Saves the checks' answers with their version and decides what happens to the report. */
export async function finishChecks(draftId: string, metadata: Metadata, results: CheckResult[]) {
  const state = await readState();
  const draft = state.submissions.find((s) => s.id === draftId)!;
  const blocked = results.some((r) => !r.pass && r.blocking);
  const flagged = results.some((r) => !r.pass && !r.blocking);
  // Passing makes the report: live at once, or once someone approves it when review is on or an advisory check flagged it.
  const status = blocked ? "failed" : state.settings.humanReview || flagged ? "review" : "live";
  Object.assign(draft, { metadata, results, checksVersion: state.settings.checksVersion, status, step: "done", deposit: status === "live" ? "queued" : "none", updatedAt: Date.now() });
  await writeState(state);
  return draft;
}
