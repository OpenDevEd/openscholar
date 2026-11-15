// The stop hook's side of `npm run verify`: `hook stop` reads the agent's
// stop event and sends it back while a page it changed has no passing check.
// OpenScholar and the Evidence Library run the same file; keep them in step.

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { stopDecision } from "./analysis.ts";
import { git, readJson } from "./util.ts";

/** The files this branch changed against its base branch, committed or not, with when they last changed and whether they hold a dialog, sheet, popover or menu. */
function changedFiles(root: string, baseBranch: string, overlay: RegExp): { path: string; mtimeMs: number; overlay: boolean }[] {
  let base = "HEAD";
  try {
    base = git(["merge-base", "HEAD", baseBranch], root);
  } catch {
    // No base branch here: compare with the last commit.
  }
  const names = new Set([...git(["diff", "--name-only", base], root).split("\n"), ...git(["ls-files", "--others", "--exclude-standard"], root).split("\n")]);
  // A deleted file has no time of its own; its folder changed when it went.
  const changedAt = (name: string) => {
    let target = path.join(root, name);
    while (!existsSync(target)) target = path.dirname(target);
    return statSync(target).mtimeMs;
  };
  const holdsOverlay = (name: string) => /\.tsx$/.test(name) && existsSync(path.join(root, name)) && overlay.test(readFileSync(path.join(root, name), "utf8"));
  return [...names].filter(Boolean).map((name) => ({ path: name, mtimeMs: changedAt(name), overlay: holdsOverlay(name) }));
}

async function readInput(): Promise<{ stop_hook_active?: boolean; transcript_path?: string | null }> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const sessionStart = (transcript: string | null | undefined) => (transcript && existsSync(transcript) ? statSync(transcript).birthtimeMs : 0);

/** When the last passing check ran and how many overlays it opened. A recorded skip has no count; the user's "don't verify" is `off`. */
function lastPass(file: string): { lastPassMs: number | null; lastPassOpened?: number; off?: boolean } {
  const { at = null, opened, off } = readJson<{ at: number; opened?: number; off?: boolean }>(file) ?? {};
  return { lastPassMs: at, lastPassOpened: opened, off };
}

export async function hookStop(options: { root: string; baseBranch: string; userFacing: RegExp; overlay: RegExp; lastPassFile: string; start: string }) {
  const input = await readInput();
  const decision = stopDecision({
    stopHookActive: input.stop_hook_active === true,
    sessionStartMs: sessionStart(input.transcript_path),
    ...lastPass(options.lastPassFile),
    changed: changedFiles(options.root, options.baseBranch, options.overlay),
    userFacing: options.userFacing,
  });
  if (decision.block) process.stdout.write(JSON.stringify({ decision: "block", reason: told(decision, options.start) }));
}

const told = (decision: { files: string[]; unopened?: true }, start: string) =>
  [decision.unopened ? unopened(decision.files) : reason(decision.files, start), RESTATE].join(" ");

// Before the steps, so an agent the user told not to verify stops here instead of starting a check.
const OFF = 'If the user said not to verify, run `npm run verify -- off "<their words>"` and nothing else: the hook stays quiet for the rest of this session.';
// The user reads only the last message, and this one comes after the reply.
const RESTATE = "Then end with your reply to the user again in full, since they see only your last message.";

function listed(files: string[]): string {
  const more = files.length > 8 ? `, and ${files.length - 8} more` : "";
  return files.slice(0, 8).join(", ") + more;
}

function unopened(files: string[]): string {
  return [
    `You changed files that hold a dialog, sheet, popover or menu (${listed(files)}), and the last passing \`npm run verify -- shift\` opened none.`,
    OFF,
    'Run it again with a --do step that opens each one you changed, such as --do \'click role=button[name="Share"]\'. With the data slowed, anything that pops in after it opens is reported: have it there when it opens by reading it where the trigger is, or fade it in.',
    'If nothing in them changed for a person, record why with `npm run verify -- skip "<reason>"`.',
  ].join(" ");
}

function reason(files: string[], start: string): string {
  return [
    `You changed user-facing files (${listed(files)}) and no \`npm run verify -- shift\` has passed since.`,
    OFF,
    `Start it with \`${start}\` if it isn't running, then run \`npm run verify -- shift <route>\` for each route those files affect, with --do steps for the interactions you changed. Fix what it reports and look at the screenshots it lists.`,
    'If nothing a person sees changed, record why with `npm run verify -- skip "<reason>"`.',
  ].join(" ");
}
