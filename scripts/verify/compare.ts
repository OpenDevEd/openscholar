// Runs a check on this branch's server and on the comparison server, and
// decides which problems are new. OpenScholar and the Evidence Library run the
// same file; keep them in step.

import { mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

import { knownAfterLooks, type Item } from "./analysis.ts";
import { runSite, type RunOptions, type SiteRun } from "./browser.ts";
import { slug, writeJson } from "./util.ts";

export type Comparison = {
  /** This branch's server. */
  local: string;
  /** The server it is compared with, or null to check this branch alone. */
  base: string | null;
  /** How the comparison server is named in messages: "dev.openscholar.ai", "origin/main". */
  baseName: string;
  target: string;
  browsers: string[];
  options: RunOptions;
  /** Where runs keep their reports and screenshots; the last 20 stay. */
  runsDir: string;
};

type Entry = { browser: string; phase: string; line: string; keys: string[]; deltas?: Item["deltas"] };
// `opened` is how many dialogs, sheets, popovers and menus this branch opened, over every browser.
type Outcome = { added: Entry[]; existing: Entry[]; baseSeen: Entry[]; notes: string[]; shots: string[]; runDir: string; opened: number };

function newRunDir(runsDir: string, target: string): string {
  const runDir = path.join(runsDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${slug(target)}`);
  mkdirSync(runDir, { recursive: true });
  const runs = readdirSync(runsDir).sort();
  for (const old of runs.slice(0, Math.max(0, runs.length - 20))) rmSync(path.join(runsDir, old), { recursive: true, force: true });
  return runDir;
}

/** One look at the comparison server, or null when the run itself broke: that says nothing about this branch. */
async function look(comparison: Comparison, browser: string, outcome: Outcome): Promise<SiteRun | null> {
  try {
    return await runSite(browser, comparison.base!, comparison.target, comparison.options, null, true);
  } catch (error) {
    outcome.notes.push(`${browser}: checking ${comparison.baseName} failed (${(error as Error).message.split("\n")[0]}).`);
    return null;
  }
}

function recordLook(outcome: Outcome, browser: string, base: SiteRun, attempt: number) {
  const seen = base.phases.flatMap((phase) => phase.items.map((item) => ({ browser, phase: `${phase.name} (look ${attempt})`, line: item.line, keys: item.keys, deltas: item.deltas })));
  outcome.baseSeen.push(...seen);
}

function noteStop(outcome: Outcome, browser: string, base: SiteRun, baseName: string) {
  if (base.stopped) outcome.notes.push(`${browser}: ${baseName} stopped at ${base.stopped}, so what follows counts as new.`);
}

const allKnown = (known: boolean[][]) => known.every((phase) => !phase.includes(false));
// A comparison run that stopped early has no items for the phases after it.
const itemsOf = (run: SiteRun, index: number) => run.phases[index]?.items ?? [];

/**
 * Which of this branch's problems the comparison server has too. A run there
 * can miss a problem it has, by timing, so a problem that still looks new gets
 * a second look (knownAfterLooks keeps the looks from adding up).
 */
type Looks = { browser: string; local: SiteRun; looks: Item[][][]; known: boolean[][] };

/** Takes one more look at the comparison server and updates what it vouches for. */
async function lookAgain(comparison: Comparison, state: Looks, attempt: number, outcome: Outcome) {
  const base = await look(comparison, state.browser, outcome);
  if (!base) return;
  recordLook(outcome, state.browser, base, attempt);
  if (attempt === 1) noteStop(outcome, state.browser, base, comparison.baseName);
  state.local.phases.forEach((_, index) => state.looks[index].push(itemsOf(base, index)));
  state.known = state.local.phases.map((phase, index) => knownAfterLooks(phase.items, state.looks[index]));
}

async function known(comparison: Comparison, browser: string, local: SiteRun, outcome: Outcome): Promise<boolean[][]> {
  const state: Looks = { browser, local, looks: local.phases.map(() => []), known: local.phases.map((phase) => phase.items.map(() => false)) };
  const attempts = comparison.base ? 2 : 0;
  for (let attempt = 1; attempt <= attempts && !allKnown(state.known); attempt++) await lookAgain(comparison, state, attempt, outcome);
  return state.known;
}

// An error page always fails, even where the comparison server errors too.
const onBaseToo = (item: Item, known: boolean) => item.kind !== "http" && known;
const anyNew = (local: SiteRun, onBase: boolean[][]) => local.phases.some((phase, index) => phase.items.some((item, at) => !onBaseToo(item, onBase[index][at])));

/**
 * Whether each of this branch's problems shows again on a second run here. A
 * real regression shows every time; a race during loading, which the
 * comparison server has too but happened not to show, comes and goes. The
 * second run only happens when something looks new.
 */
async function again(comparison: Comparison, browser: string, local: SiteRun, onBase: boolean[][]): Promise<boolean[][]> {
  const all = local.phases.map((phase) => phase.items.map(() => true));
  // Without a comparison, a second run would only replay steps that may save data.
  if (!comparison.base || !anyNew(local, onBase)) return all;
  const second = await runSite(browser, comparison.local, comparison.target, comparison.options, null, true);
  // A second run that stopped short shows nothing about the phases it missed.
  if (second.stopped) return all;
  return local.phases.map((phase, index) => knownAfterLooks(phase.items, [second.phases[index]?.items ?? []]));
}

function sort(outcome: Outcome, entry: Entry, item: Item, known: boolean, repeated: boolean) {
  if (onBaseToo(item, known)) return outcome.existing.push(entry);
  if (repeated || item.kind === "http") return outcome.added.push(entry);
  outcome.notes.push(`${entry.browser}, ${entry.phase}: showed once and not on a second run of this branch, so it isn't counted: ${entry.line}`);
}

async function checkBrowser(comparison: Comparison, browser: string, runDir: string, outcome: Outcome) {
  const local = await runSite(browser, comparison.local, comparison.target, comparison.options, runDir, false);
  outcome.shots.push(...local.shots);
  outcome.opened += local.opened;
  const onBase = await known(comparison, browser, local, outcome);
  const repeated = await again(comparison, browser, local, onBase);
  local.phases.forEach((phase, index) => {
    phase.items.forEach((item, at) => {
      const entry = { browser, phase: phase.name, line: item.line, keys: item.keys, deltas: item.deltas };
      sort(outcome, entry, item, onBase[index][at], repeated[index][at]);
    });
  });
}

/** Runs the check in each browser and writes report.json into a new run folder. */
export async function compare(comparison: Comparison): Promise<Outcome> {
  const runDir = newRunDir(comparison.runsDir, comparison.target);
  const outcome: Outcome = { added: [], existing: [], baseSeen: [], notes: [], shots: [], runDir, opened: 0 };
  for (const browser of comparison.browsers) await checkBrowser(comparison, browser, runDir, outcome);
  const { target, base, browsers, options } = comparison;
  writeJson(path.join(runDir, "report.json"), { target, base, steps: options.steps.map((step) => step.label), browsers, slow: options.slow, ...outcome });
  return outcome;
}

function printExisting(baseName: string, existing: Entry[]) {
  if (existing.length === 0) return;
  console.log(`${baseName} has ${existing.length} of these too, so they are not from this branch:`);
  for (const entry of existing.slice(0, 10)) console.log(`  ${entry.browser}, ${entry.phase}: ${entry.line}`);
  if (existing.length > 10) console.log(`  and ${existing.length - 10} more in the report`);
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function printAdded(comparison: Comparison, outcome: Outcome) {
  const versus = comparison.base ? ` that ${comparison.baseName} doesn't have` : "";
  console.log(`Fail: ${plural(outcome.added.length, "problem")}${versus}:`);
  for (const entry of outcome.added) console.log(`  ${entry.browser}, ${entry.phase}: ${entry.line}`);
  console.log(`Report: ${path.join(outcome.runDir, "report.json")}`);
}

/** Prints what the check found. Returns whether it passed. */
export function report(comparison: Comparison, outcome: Outcome): boolean {
  printShots(outcome.shots);
  for (const note of outcome.notes) console.log(note);
  printExisting(comparison.baseName, outcome.existing);
  if (outcome.added.length > 0) {
    printAdded(comparison, outcome);
    return false;
  }
  const fresh = comparison.base ? "new " : "";
  console.log(`Pass: no ${fresh}layout shifts, flashes or page errors in ${comparison.browsers.join(" and ")} on ${comparison.target}.`);
  return true;
}

export function printShots(shots: string[]) {
  console.log(`Screenshots (look at them):\n${shots.map((shot) => `  ${shot}`).join("\n")}`);
}
