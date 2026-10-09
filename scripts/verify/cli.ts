// `npm run verify -- <command>`: start this worktree's app, prove a change in
// real browsers against dev.openscholar.ai, and stop what it started. The
// verify skill (.agents/skills/verify/SKILL.md) says when to use each command.
//
// analysis, recorder, browser, compare, hook and util are the same files as
// the Evidence Library's tools/verify (OpenDevEd/new-el); this file is
// OpenScholar's own.

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs, parseEnv } from "node:util";
import type { Page } from "@playwright/test";

import { open, parseStep, type RunOptions } from "./browser.ts";
import { compare, printShots, report, type Comparison } from "./compare.ts";
import { hookStop } from "./hook.ts";
import { git, listening, members, readJson, runsNext, sleep, stopGroup, withLock, withTimeout, writeJson } from "./util.ts";

const ROOT = git(["rev-parse", "--show-toplevel"], process.cwd());
const STATE = path.join(ROOT, ".verify");
const SERVER = path.join(STATE, "server.json");
const LAST_PASS = path.join(STATE, "last-pass.json");
const CONVEX_URL = "https://convex.opendev.space";
const DEV_SITE = "https://dev.openscholar.ai";
const VERIFY_USER = "verify-agent+clerk_test@example.com";
// Files a person sees. Route handlers and other .ts files under app/ are not.
const USER_FACING = /^(app|components)\/.+\.(tsx|css)$/;
// Elements whose movement is their job: progress bars, Next's dev badge, and
// anything a page marks with data-verify-ignore.
const ALWAYS_ALLOWED = ["[role=progressbar]", "[data-verify-ignore]", "nextjs-portal"];
// Files that never reach the built app; `next dev` itself rewrites AGENTS.md.
const NOT_BUILT = [":!*.md", ":!docs", ":!plans", ":!tests", ":!e2e", ":!scripts", ":!.agents", ":!.claude"];

type Server = { pid: number; port: number; url: string; mode: "dev" | "prod"; log: string; opened?: boolean; fingerprint?: string };
type Values = Record<string, string | boolean | string[] | undefined>;

/** What the working tree holds that a production build bakes in: the commit, uncommitted changes and untracked files. */
function fingerprint(): string {
  const hash = createHash("sha1").update(git(["rev-parse", "HEAD"], ROOT));
  hash.update(execFileSync("git", ["diff", "HEAD", "--", ".", ...NOT_BUILT], { cwd: ROOT }));
  for (const name of git(["ls-files", "--others", "--exclude-standard", "--", ".", ...NOT_BUILT], ROOT).split("\n").filter(Boolean).sort()) {
    hash.update(name);
    if (existsSync(path.join(ROOT, name))) hash.update(readFileSync(path.join(ROOT, name)));
  }
  return hash.digest("hex");
}

/** The main checkout is the only one allowed to hold the Convex admin key. */
const mainCheckout = () => git(["worktree", "list", "--porcelain"], ROOT).split("\n")[0].replace(/^worktree /, "");

/** Gives a worktree the main checkout's .env.local, minus what only the main checkout may hold. */
function copyEnv(file: string, isMain: boolean) {
  const source = path.join(mainCheckout(), ".env.local");
  if (isMain || !existsSync(source)) throw new Error(`No .env.local here or in ${source}.`);
  const lines = readFileSync(source, "utf8").split("\n").filter((line) => !/^\s*CONVEX_SELF_HOSTED_/.test(line));
  writeFileSync(file, lines.join("\n"));
  console.log(`Copied ${source} without CONVEX_SELF_HOSTED_* into this worktree.`);
}

function ensureEnv(): Record<string, string> {
  const file = path.join(ROOT, ".env.local");
  const isMain = path.resolve(mainCheckout()) === path.resolve(ROOT);
  if (!existsSync(file)) copyEnv(file, isMain);
  const env = parseEnv(readFileSync(file, "utf8")) as Record<string, string>;
  if (env.NEXT_PUBLIC_CONVEX_URL !== CONVEX_URL) throw new Error(`.env.local must point NEXT_PUBLIC_CONVEX_URL at ${CONVEX_URL}.`);
  if (!isMain && (env.CONVEX_SELF_HOSTED_ADMIN_KEY || env.CONVEX_SELF_HOSTED_URL)) {
    throw new Error("Only the main checkout may hold CONVEX_SELF_HOSTED_*. Remove those lines from this worktree's .env.local.");
  }
  return env;
}

/** A port that stays the same for a worktree, so links keep working between runs. */
async function pickPort(): Promise<number> {
  let port = 3600 + (Number.parseInt(createHash("sha1").update(ROOT).digest("hex").slice(0, 6), 16) % 300);
  while (await listening(port)) port += 1;
  return port;
}

async function running(): Promise<Server | null> {
  const server = readJson<Server>(SERVER);
  return server && runsNext(server.pid, server.port) && (await listening(server.port)) ? server : null;
}

/** A server in the other mode, or a production build older than the code, is replaced. */
function outdated(server: Server, mode: Server["mode"]): string | null {
  if (server.mode !== mode) return `Replacing the ${server.mode} server.`;
  if (mode === "prod" && server.fingerprint !== fingerprint()) return "The code changed since the last build; building again.";
  return null;
}

async function answers(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(60_000) })).status < 500;
  } catch {
    return false;
  }
}

async function start(mode: Server["mode"]): Promise<Server> {
  const port = await pickPort();
  const log = path.join(STATE, "server.log");
  mkdirSync(STATE, { recursive: true });
  if (mode === "prod") {
    console.log("Building for production...");
    execFileSync("npx", ["next", "build"], { cwd: ROOT, stdio: ["ignore", openSync(log, "a"), openSync(log, "a")] });
  }
  const out = openSync(log, "a");
  const child = spawn("npx", ["next", mode === "prod" ? "start" : "dev", "-p", String(port)], { cwd: ROOT, detached: true, stdio: ["ignore", out, out] });
  child.unref();
  const server: Server = { pid: child.pid!, port, url: `http://localhost:${port}`, mode, log, ...(mode === "prod" ? { fingerprint: fingerprint() } : {}) };
  writeJson(SERVER, server);
  try {
    await ready(server);
  } catch (error) {
    await stopGroup(server.pid);
    rmSync(SERVER, { force: true });
    throw error;
  }
  return server;
}

/** Waits until the server answers; fails if it exits or takes longer than four minutes. */
async function ready(server: Server) {
  for (const deadline = Date.now() + 240_000; !(await answers(server.url)); await sleep(1_000)) {
    // Just started here, so any process left in its group is the server.
    if (members(server.pid).length === 0) throw new Error(`The server exited. See ${server.log}.`);
    if (Date.now() > deadline) throw new Error(`The server did not answer within 4 minutes. See ${server.log}.`);
  }
}

function openOnce(server: Server) {
  if (server.opened) return;
  execFileSync("open", [server.url]);
  writeJson(SERVER, { ...server, opened: true });
  console.log("Opened it in the default browser. Later messages end with the link instead of opening it again.");
}

async function up(values: Values) {
  ensureEnv();
  const mode = values.prod ? "prod" : "dev";
  let server = await running();
  const reason = server && outdated(server, mode);
  if (reason) {
    console.log(reason);
    await down();
    server = null;
  }
  server ??= await start(mode);
  console.log(`Running (${server.mode}): ${server.url}`);
  if (values.open) openOnce(server);
}

async function down() {
  const server = readJson<Server>(SERVER);
  if (!server) return console.log("Nothing is running from this worktree.");
  if (!runsNext(server.pid, server.port)) {
    rmSync(SERVER, { force: true });
    return console.log(`Process group ${server.pid} no longer runs this worktree's server; nothing to stop.`);
  }
  if (!(await stopGroup(server.pid))) {
    process.exitCode = 1;
    return console.log(`Process group ${server.pid} is still running; kept ${SERVER} so \`down\` can try again.`);
  }
  rmSync(SERVER, { force: true });
  const stillUsed = await listening(server.port);
  console.log(stillUsed ? `Stopped our server, but something else answers on port ${server.port}.` : `Stopped ${server.url}.`);
  if (stillUsed) process.exitCode = 1;
}

async function environmentProblems(): Promise<string[]> {
  try {
    const env = ensureEnv();
    const problems = env.CLERK_SECRET_KEY && env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? [] : ["Clerk keys are missing from .env.local."];
    const convex = await fetch(`${CONVEX_URL}/version`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
    return convex?.ok ? problems : [...problems, `The shared Convex backend at ${CONVEX_URL} does not answer.`];
  } catch (error) {
    return [(error as Error).message];
  }
}

async function browserProblems(): Promise<string[]> {
  const { chromium, firefox } = await import("@playwright/test");
  return [chromium, firefox].filter((browser) => !existsSync(browser.executablePath())).map((browser) => `Playwright's ${browser.name()} is not installed. Run \`npx playwright install ${browser.name()}\`.`);
}

async function status() {
  const server = await running();
  console.log(server ? `Server: ${server.url} (${server.mode}, pid ${server.pid})` : "Server: not running. Start it with `npm run verify -- up`.");
  const problems = [...(await environmentProblems()), ...(await browserProblems())];
  console.log(problems.length === 0 ? "Environment: ready." : problems.map((problem) => `Problem: ${problem}`).join("\n"));
  if (problems.length > 0) process.exitCode = 1;
}

async function signIn(page: Page, url: string, email: string, attempt = 1) {
  const { clerk } = await import("@clerk/testing/playwright");
  try {
    await open(page, url);
    await clerk.loaded({ page });
    await clerk.signIn({ page, emailAddress: email });
  } catch (error) {
    if (attempt === 2) {
      throw new Error(`Signing in as ${email} on ${url} failed twice: ${(error as Error).message.split("\n")[0]}. Clerk's development API is sometimes slow; run it again, or use --anon for a page that needs no account.`);
    }
    return signIn(page, url, email, attempt + 1);
  }
  // The app reloads once the session exists; let that finish first.
  await sleep(500);
  await page.waitForLoadState("load");
}

// The verify user's own organization turns on every organization feature,
// so gated pages (extraction, Evidence Libraries, authors) open for it. Clerk
// syncs the organization's public metadata to Convex. The development Clerk
// instance has organization slugs turned off, so it is found by name.
const VERIFY_ORGANIZATION = { name: "Verify Agent", publicMetadata: { evidenceLibraries: true, authors: true, extraction: true } };
const wanted = (metadata: Record<string, unknown> | null | undefined) => Object.entries(VERIFY_ORGANIZATION.publicMetadata).every(([key, value]) => metadata?.[key] === value);

type Clerk = ReturnType<typeof import("@clerk/backend").createClerkClient>;

/** Puts the verify user in the Verify Agent organization, creating or updating it. */
async function joinOrganization(clerk: Clerk, userId: string, membership: { organization: { id: string } } | undefined) {
  if (membership) return clerk.organizations.updateOrganizationMetadata(membership.organization.id, { publicMetadata: VERIFY_ORGANIZATION.publicMetadata });
  const found = (await clerk.organizations.getOrganizationList({ query: VERIFY_ORGANIZATION.name, limit: 10 })).data.find((organization) => organization.name === VERIFY_ORGANIZATION.name);
  if (!found) return clerk.organizations.createOrganization({ ...VERIFY_ORGANIZATION, createdBy: userId });
  await clerk.organizations.createOrganizationMembership({ organizationId: found.id, userId, role: "org:admin" });
  return clerk.organizations.updateOrganizationMetadata(found.id, { publicMetadata: VERIFY_ORGANIZATION.publicMetadata });
}

async function existingUser(clerk: Clerk, email: string) {
  return (await clerk.users.getUserList({ emailAddress: [email], limit: 1 })).data[0];
}

/** The verify user and its organization exist in the shared development Clerk instance; create them on first use. */
async function verifyUser(env: Record<string, string>, as: string | undefined): Promise<string> {
  const { createClerkClient } = await import("@clerk/backend");
  const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
  if (as) {
    if (!(await existingUser(clerk, as))) throw new Error(`No Clerk user ${as} in the development instance.`);
    return as;
  }
  const existing = await existingUser(clerk, VERIFY_USER);
  const user = existing ?? (await clerk.users.createUser({ emailAddress: [VERIFY_USER], firstName: "Verify", lastName: "Agent", skipPasswordRequirement: true }));
  const membership = (await clerk.users.getOrganizationMembershipList({ userId: user.id, limit: 20 })).data.find((entry) => entry.organization.name === VERIFY_ORGANIZATION.name);
  if (existing && membership && wanted(membership.organization.publicMetadata)) return VERIFY_USER;
  await joinOrganization(clerk, user.id, membership);
  // Clerk sends this to Convex by webhook; checking before it lands would test
  // the "not allowed" page instead of the feature.
  throw new Error(`Set up ${VERIFY_USER} in the "${VERIFY_ORGANIZATION.name}" organization. Clerk sends it to Convex within a few seconds: run the same command again.`);
}

async function prepareFor(values: Values): Promise<RunOptions["prepare"]> {
  const env = ensureEnv();
  Object.assign(process.env, env, { CLERK_PUBLISHABLE_KEY: env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY });
  if (values.anon === true) return async () => {};
  const email = await verifyUser(env, values.as as string | undefined);
  await (await import("@clerk/testing/playwright")).clerkSetup({ dotenv: false });
  return (_context, page, origin) => withTimeout(signIn(page, origin, email), 120_000, `Signing in on ${origin}`);
}

const number = (value: unknown, fallback: number) => Number(value ?? fallback);
const list = (value: unknown) => (value as string[] | undefined) ?? [];

async function optionsFor(values: Values, mode: string): Promise<RunOptions> {
  const shift = mode === "shift";
  return {
    steps: list(values.do).map(parseStep),
    slow: number(values.slow, shift ? 600 : 0),
    quietMs: number(values.quiet, 1_500),
    viewport: { width: number(values.width, 1440), height: number(values.height, 900) },
    allow: [...ALWAYS_ALLOWED, ...list(values.allow)].flatMap((selector) => [selector, `${selector} *`]).join(", "),
    full: values.full === true,
    analyze: shift,
    prepare: await prepareFor(values),
  };
}

async function liveServer(target: string): Promise<Server> {
  const server = await running();
  if (!server) throw new Error("Nothing is running from this worktree. Start it with `npm run verify -- up --prod`.");
  if (server.mode === "prod" && server.fingerprint !== fingerprint()) throw new Error("The production build is older than your changes. Run `npm run verify -- up --prod` again, then check.");
  if (server.mode === "dev") console.error("This server runs next dev. The final check belongs on `npm run verify -- up --prod`.");
  if (!target.startsWith("/")) throw new Error("Give a path that starts with /, such as /results.");
  return server;
}

// The same steps on the deployed dev site tell this branch's problems from the
// ones dev already has. Both sites read the same Convex data.
const baseFor = (values: Values, mode: string) =>
  mode === "shift" && values.base !== "none" ? String(values.base ?? process.env.VERIFY_BASE_URL ?? DEV_SITE) : null;

const DEFAULT_BROWSERS = { shift: "chromium,firefox", shot: "chromium" };

async function comparisonFor(target: string, values: Values, mode: "shift" | "shot"): Promise<Comparison> {
  const server = await liveServer(target);
  const base = baseFor(values, mode);
  return {
    local: server.url,
    base,
    baseName: base ?? DEV_SITE,
    target,
    browsers: String(values.browser ?? DEFAULT_BROWSERS[mode]).split(","),
    options: await optionsFor(values, mode),
    runsDir: path.join(STATE, "runs"),
  };
}

function recordPass(comparison: Comparison, built: string) {
  // Code changed during the check isn't in the build it checked.
  if (fingerprint() !== built) return console.log("The code changed during the check, so no pass is recorded. Run `npm run verify -- up --prod`, then check again.");
  const steps = comparison.options.steps.map((step) => step.label);
  writeJson(LAST_PASS, { at: Date.now(), head: git(["rev-parse", "HEAD"], ROOT), target: comparison.target, steps, browsers: comparison.browsers });
}

async function drive(target: string, values: Values, mode: "shift" | "shot") {
  const built = fingerprint();
  const comparison = await comparisonFor(target, values, mode);
  const outcome = await compare(comparison);
  if (mode === "shot") return printShots(outcome.shots);
  if (report(comparison, outcome)) recordPass(comparison, built);
  else process.exitCode = 1;
}

function skip(reason: string) {
  if (!reason.trim()) throw new Error('Say why: npm run verify -- skip "<reason>".');
  writeJson(LAST_PASS, { at: Date.now(), head: git(["rev-parse", "HEAD"], ROOT), skipped: reason });
  console.log(`Recorded: ${reason}`);
}

const HELP = `Usage: npm run verify -- <command>

  up [--open] [--prod]     Start this worktree's app (next dev, or a production build with --prod)
                           on its own port. --open opens it in the default browser once.
  down                     Stop the app this worktree started.
  status                   Show the server and check the environment.
  shift <path> [options]   Load <path> signed in, in Chromium and Firefox, with data slowed by 600ms,
                           then do the same on dev.openscholar.ai, and fail on any layout shift, flash
                           or page error that dev doesn't have. Writes screenshots.
  shot <path> [options]    Screenshots only (Chromium, no slowdown).
  skip "<reason>"          Record why this change needs no browser check.

Options for shift and shot:
  --do "<step>"            Repeat for each action: click <selector>, hover <selector>,
                           fill <selector> <text>, press <key>, wait <ms>, goto <path>.
                           Selectors are Playwright selectors: css, text=..., role=button[name="Save"].
                           Steps run in each browser and again on the comparison site: keep them
                           to interactions that save nothing.
  --browser <list>         chromium,firefox (shift default) or one of them.
  --slow <ms>              Delay for every server message (shift default 600, 0 to turn off).
  --allow <selector>       An element whose movement is intended, such as an expanding panel.
  --width <px> --height <px>  Viewport, default 1440x900. Use 390 x 844 for a phone.
  --as <email>             Sign in as this existing development user instead of the verify user.
  --anon                   Don't sign in.
  --full                   Full-page screenshots.
  --quiet <ms>             How long the page must hold still to count as settled (default 1500).
  --base <url|none>        The site to compare with (default https://dev.openscholar.ai).`;

// Only one run at a time changes this worktree's server.
const locked = <T,>(run: () => Promise<T>) => withLock(path.join(STATE, "lock"), "this worktree's other verify run", run);

const COMMANDS: Record<string, (values: Values, rest: string[]) => unknown> = {
  up: (values) => locked(() => up(values)),
  down: () => locked(() => down()),
  status: () => status(),
  shift: (values, rest) => drive(rest[0] ?? "", values, "shift"),
  shot: (values, rest) => drive(rest[0] ?? "", values, "shot"),
  skip: (_, rest) => skip(rest.join(" ")),
  hook: (_, rest) => rest[0] === "stop" && hookStop({ root: ROOT, baseBranch: "origin/dev", userFacing: USER_FACING, lastPassFile: LAST_PASS, start: "npm run verify -- up --prod" }),
};

const OPTIONS = {
  open: { type: "boolean" },
  prod: { type: "boolean" },
  do: { type: "string", multiple: true },
  browser: { type: "string" },
  slow: { type: "string" },
  allow: { type: "string", multiple: true },
  width: { type: "string" },
  height: { type: "string" },
  as: { type: "string" },
  anon: { type: "boolean" },
  full: { type: "boolean" },
  quiet: { type: "string" },
  base: { type: "string" },
} as const;

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: OPTIONS });
  const [command, ...rest] = positionals;
  const run = COMMANDS[command ?? ""];
  if (run) return run(values, rest);
  console.log(HELP);
  process.exitCode = command ? 1 : 0;
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
