// The stop hook's side of `npm run verify`: `hook stop` reads the agent's
// stop event and sends it back while a page it changed has no passing check.
// OpenScholar and the Evidence Library run the same file; keep them in step.

import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { stopDecision } from "./analysis.ts";
import { git, readJson } from "./util.ts";

/** The files this branch changed against its base branch, committed or not, with when they last changed. */
function changedFiles(root: string, baseBranch: string): { path: string; mtimeMs: number }[] {
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
  return [...names].filter(Boolean).map((name) => ({ path: name, mtimeMs: changedAt(name) }));
}

async function readInput(): Promise<{ stop_hook_active?: boolean; transcript_path?: string | null }> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const sessionStart = (transcript: string | null | undefined) => (transcript && existsSync(transcript) ? statSync(transcript).birthtimeMs : 0);

const lastPass = (file: string) => readJson<{ at: number }>(file)?.at ?? null;

export async function hookStop(options: { root: string; baseBranch: string; userFacing: RegExp; lastPassFile: string; start: string }) {
  const input = await readInput();
  const decision = stopDecision({
    stopHookActive: input.stop_hook_active === true,
    sessionStartMs: sessionStart(input.transcript_path),
    lastPassMs: lastPass(options.lastPassFile),
    changed: changedFiles(options.root, options.baseBranch),
    userFacing: options.userFacing,
  });
  if (decision.block) process.stdout.write(JSON.stringify({ decision: "block", reason: reason(decision.files, options.start) }));
}

function listed(files: string[]): string {
  const more = files.length > 8 ? `, and ${files.length - 8} more` : "";
  return files.slice(0, 8).join(", ") + more;
}

function reason(files: string[], start: string): string {
  return [
    `You changed user-facing files (${listed(files)}) and no \`npm run verify -- shift\` has passed since.`,
    `Start it with \`${start}\` if it isn't running, then run \`npm run verify -- shift <route>\` for each route those files affect, with --do steps for the interactions you changed. Fix what it reports and look at the screenshots it lists.`,
    'If nothing a person sees changed, or the user said not to test, record why with `npm run verify -- skip "<reason>"`.',
  ].join(" ");
}
