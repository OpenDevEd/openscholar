// `npm run verify -- <command>`: start this worktree's app, prove a change in
// real browsers, and stop what it started. The verify skill
// (.agents/skills/verify/SKILL.md) says when to use each command.

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { parseEnv, parseArgs } from "node:util";
import { analyzePhase, knownAfterLooks, stopDecision, type Finding, type Frame, type Item, type Phase } from "./analysis.ts";

const ROOT = git(["rev-parse", "--show-toplevel"], process.cwd());
const STATE = path.join(ROOT, ".verify");
const SERVER = path.join(STATE, "server.json");
const LAST_PASS = path.join(STATE, "last-pass.json");
const CONVEX_URL = "https://convex.opendev.space";
const DEV_SITE = "https://dev.openscholar.ai";
const VERIFY_USER = "verify-agent+clerk_test@example.com";
// Elements whose movement is their job: progress bars, Next's dev badge, and
// anything a page marks with data-verify-ignore.
const ALWAYS_ALLOWED = ["[role=progressbar]", "[data-verify-ignore]", "nextjs-portal"];

type Server = { pid: number; port: number; url: string; mode: "dev" | "prod"; log: string; opened?: boolean };

function git(args: string[], cwd = ROOT): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** The processes in a process group: the npx launcher `up` started and the Next.js server under it. */
function members(group: number): string[] {
  const table = execFileSync("ps", ["-ax", "-o", "pgid=,command="], { encoding: "utf8" });
  return table.split("\n").flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(.*)$/);
    return match && Number(match[1]) === group ? [match[2]] : [];
  });
}

/**
 * Whether the group in server.json is still the server this worktree
 * started. A pid can be reused after a crash or a reboot, so a group that no
 * longer runs Next.js is never signalled.
 */
const ours = (server: Server) => members(server.pid).some((command) => /\bnext\b/.test(command));

function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The main checkout is the only one allowed to hold the Convex admin key. */
function mainCheckout(): string {
  return git(["worktree", "list", "--porcelain"]).split("\n")[0].replace(/^worktree /, "");
}

/** Gives a worktree the main checkout's environment, minus what only the main checkout may hold. */
function ensureEnv(): Record<string, string> {
  const file = path.join(ROOT, ".env.local");
  const isMain = path.resolve(mainCheckout()) === path.resolve(ROOT);
  if (!existsSync(file)) {
    const source = path.join(mainCheckout(), ".env.local");
    if (isMain || !existsSync(source)) throw new Error(`No .env.local here or in ${source}.`);
    const lines = readFileSync(source, "utf8").split("\n").filter((line) => !/^\s*CONVEX_SELF_HOSTED_/.test(line));
    writeFileSync(file, lines.join("\n"));
    console.log(`Copied ${source} without CONVEX_SELF_HOSTED_* into this worktree.`);
  }
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
  if (!server) return null;
  if (ours(server) && (await listening(server.port))) return server;
  return null;
}

async function up(values: { prod?: boolean; open?: boolean }) {
  ensureEnv();
  let server = await running();
  if (!server) {
    const mode = values.prod ? "prod" : "dev";
    const port = await pickPort();
    const log = path.join(STATE, "server.log");
    mkdirSync(STATE, { recursive: true });
    if (mode === "prod") {
      console.log("Building for production...");
      execFileSync("npx", ["next", "build"], { cwd: ROOT, stdio: ["ignore", openSync(log, "a"), openSync(log, "a")] });
    }
    const out = openSync(log, "a");
    const child = spawn("npx", ["next", mode === "prod" ? "start" : "dev", "-p", String(port)], {
      cwd: ROOT,
      detached: true,
      stdio: ["ignore", out, out],
    });
    child.unref();
    server = { pid: child.pid!, port, url: `http://localhost:${port}`, mode, log };
    writeJson(SERVER, server);
    const deadline = Date.now() + 240_000;
    while (true) {
      try {
        const response = await fetch(server.url, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
        if (response.status < 500) break;
      } catch {
        // Not answering yet.
      }
      // Just started here, so any process left in its group is the server.
      if (members(server.pid).length === 0) throw new Error(`The server exited. See ${log}.`);
      if (Date.now() > deadline) throw new Error(`The server did not answer within 4 minutes. See ${log}.`);
      await sleep(1_000);
    }
  }
  console.log(`Running (${server.mode}): ${server.url}`);
  if (values.open && !server.opened) {
    execFileSync("open", [server.url]);
    writeJson(SERVER, { ...server, opened: true });
    console.log("Opened it in the default browser. Later messages end with the link instead of opening it again.");
  }
}

async function down() {
  const server = readJson<Server>(SERVER);
  if (!server) {
    console.log("Nothing is running from this worktree.");
    return;
  }
  if (ours(server)) {
    // The whole group, so a Next.js server whose launcher already exited stops too.
    for (const signal of ["SIGTERM", "SIGKILL"] as const) {
      try {
        process.kill(-server.pid, signal);
      } catch {
        // The group is already gone.
      }
      for (let waited = 0; waited < 10_000 && members(server.pid).length > 0; waited += 250) await sleep(250);
      if (members(server.pid).length === 0) break;
    }
    if (members(server.pid).length > 0) {
      console.log(`Process group ${server.pid} is still running; kept ${SERVER} so \`down\` can try again.`);
      process.exitCode = 1;
      return;
    }
  } else {
    rmSync(SERVER, { force: true });
    console.log(`Process group ${server.pid} no longer runs this worktree's server; nothing to stop.`);
    return;
  }
  rmSync(SERVER, { force: true });
  const stillUsed = await listening(server.port);
  console.log(stillUsed ? `Stopped our server, but something else answers on port ${server.port}.` : `Stopped ${server.url}.`);
  if (stillUsed) process.exitCode = 1;
}

async function status() {
  const problems: string[] = [];
  const server = await running();
  console.log(server ? `Server: ${server.url} (${server.mode}, pid ${server.pid})` : "Server: not running. Start it with `npm run verify -- up`.");
  try {
    const env = ensureEnv();
    if (!env.CLERK_SECRET_KEY || !env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) problems.push("Clerk keys are missing from .env.local.");
    const convex = await fetch(`${CONVEX_URL}/version`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (!convex?.ok) problems.push(`The shared Convex backend at ${CONVEX_URL} does not answer.`);
  } catch (error) {
    problems.push((error as Error).message);
  }
  const { chromium, firefox } = await import("@playwright/test");
  for (const browser of [chromium, firefox]) {
    if (!existsSync(browser.executablePath())) problems.push(`Playwright's ${browser.name()} is not installed. Run \`npx playwright install ${browser.name()}\`.`);
  }
  console.log(problems.length === 0 ? "Environment: ready." : problems.map((problem) => `Problem: ${problem}`).join("\n"));
  if (problems.length > 0) process.exitCode = 1;
}

// Runs inside the page from its first script. Records, once per animation
// frame, what changed: layout boxes (offsets, so transforms never count),
// elements added or removed, and lines of visible text. Must stay plain
// JavaScript with no outside references: Playwright sends it as source.
function recorder(config: { allow: string }) {
  const ids = new WeakMap<Element, number>();
  const nodes = new Map<number, HTMLElement>();
  const last = new Map<number, number[]>();
  const lines = new Map<string, number>();
  let nextId = 1;
  let mutated = true;
  let allowed = new Set<Element>();
  const state = { frames: [] as unknown[], lastChange: 0, parsed: null as number | null, baseline: null as number | null };
  (window as unknown as { __verify: unknown }).__verify = {
    take: () => {
      const frames = state.frames;
      state.frames = [];
      return { frames, parsed: state.parsed, baseline: state.baseline };
    },
    times: () => [state.lastChange, performance.now()],
    // What identifies an element across two sites: tag, classes and label,
    // never its text or position, which differ with data and timing.
    key: (id: number) => {
      const element = nodes.get(id);
      if (!element) return `element ${id}`;
      const classes = (element.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 4).join(".");
      const label = element.getAttribute("aria-label") ?? element.getAttribute("data-testid") ?? element.getAttribute("data-slot") ?? element.getAttribute("role") ?? "";
      return `${element.tagName.toLowerCase()}.${classes}[${label}]`;
    },
    describe: (id: number) => {
      const element = nodes.get(id);
      if (!element) return `element ${id}`;
      const label = element.getAttribute("aria-label") ?? element.getAttribute("data-testid") ?? element.getAttribute("data-slot") ?? element.getAttribute("role");
      const text = (element.innerText ?? "").trim().replace(/\s+/g, " ").slice(0, 50);
      const classes = (element.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 4);
      const trail: string[] = [];
      for (let node: Element | null = element.parentElement; node && node !== document.body && trail.length < 2; node = node.parentElement) {
        trail.unshift(node.tagName.toLowerCase() + (node.id ? `#${node.id}` : ""));
      }
      const self = element.tagName.toLowerCase() + (element.id ? `#${element.id}` : "") + (classes.length ? `.${classes.join(".")}` : "");
      return `${[...trail, self].join(" > ")}${label ? ` [${label}]` : ""}${text ? ` "${text}"` : ""}`;
    },
  };
  new MutationObserver(() => {
    mutated = true;
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  // Recording counts from the parsed document with every font it declares
  // loaded. A weight first used when data arrives would otherwise swap in
  // later, at a different moment on each site.
  document.addEventListener("DOMContentLoaded", () => {
    state.parsed = performance.now();
    const loads: Promise<unknown>[] = [];
    document.fonts.forEach((face) => {
      loads.push(face.load().catch(() => null));
    });
    void Promise.all(loads)
      .then(() => document.fonts.ready)
      .then(() => {
        state.baseline = performance.now();
      });
  });

  // Whether an element is on screen now, measured where the browser draws it,
  // so scrolling counts. Layout boxes stay transform-free for movement.
  const onScreen = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
  };
  const shown = new Map<number, boolean>();
  // A wrapper that only grows around new content shows nothing; a card,
  // field or panel that draws a box shows its edge moving.
  const drawsBox = (element: HTMLElement) => {
    const style = getComputedStyle(element);
    const borders = ["Top", "Right", "Bottom", "Left"].some(
      (side) => Number.parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 && style.getPropertyValue(`border-${side.toLowerCase()}-style`) !== "none",
    );
    return !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(style.backgroundColor) || style.backgroundImage !== "none" || style.boxShadow !== "none" || borders;
  };

  function tick() {
    const t = performance.now();
    const moved: { id: number; dx: number; dy: number; dw: number; dh: number }[] = [];
    const added: { id: number; box: number[] }[] = [];
    const removed: { id: number; box: number[] }[] = [];
    const textAdded: string[] = [];
    const textRemoved: string[] = [];
    if (document.body) {
      if (mutated) allowed = new Set(document.querySelectorAll(config.allow));
      const positions = new Map<Element, number[]>();
      const at = (element: Element | null): number[] => {
        if (!(element instanceof HTMLElement)) return [0, 0];
        let position = positions.get(element);
        if (!position) {
          const parent = at(element.offsetParent);
          position = [parent[0] + element.offsetLeft, parent[1] + element.offsetTop];
          positions.set(element, position);
        }
        return position;
      };
      const deltas = new Map<number, number[]>();
      const seen = new Set<number>();
      for (const element of document.body.getElementsByTagName("*")) {
        if (!(element instanceof HTMLElement) || allowed.has(element)) continue;
        const width = element.offsetWidth;
        const height = element.offsetHeight;
        if (width === 0 || height === 0) continue;
        let id = ids.get(element);
        if (!id) {
          id = nextId++;
          ids.set(element, id);
          nodes.set(id, element);
        }
        seen.add(id);
        const [x, y] = at(element);
        const box = [x, y, width, height];
        const previous = last.get(id);
        last.set(id, box);
        if (!previous) {
          const now = onScreen(element);
          shown.set(id, now);
          if (now) added.push({ id, box });
          continue;
        }
        const delta = [x - previous[0], y - previous[1], width - previous[2], height - previous[3]];
        if (delta.every((value) => Math.abs(value) < 1)) continue;
        deltas.set(id, delta);
        // A child carried along by a moving parent is not a separate shift.
        let parent = element.parentElement;
        while (parent && !(ids.has(parent) && last.has(ids.get(parent)!))) parent = parent.parentElement;
        const parentDelta = parent ? deltas.get(ids.get(parent)!) : undefined;
        const carried = !!parentDelta && parentDelta[0] === delta[0] && parentDelta[1] === delta[1] && delta[2] === 0 && delta[3] === 0;
        const unseenResize = delta[0] === 0 && delta[1] === 0 && !drawsBox(element);
        const was = shown.get(id) ?? false;
        const now = onScreen(element);
        shown.set(id, now);
        if (!carried && !unseenResize && (was || now)) moved.push({ id, dx: delta[0], dy: delta[1], dw: delta[2], dh: delta[3] });
      }
      for (const [id, box] of last) {
        if (seen.has(id)) continue;
        last.delete(id);
        if (shown.get(id)) removed.push({ id, box });
        shown.delete(id);
      }
      if (mutated) {
        const now = new Map<string, number>();
        for (const line of document.body.innerText.split("\n")) {
          const text = line.trim();
          if (text) now.set(text, (now.get(text) ?? 0) + 1);
        }
        for (const [text, count] of now) for (let extra = count - (lines.get(text) ?? 0); extra > 0; extra--) textAdded.push(text);
        for (const [text, count] of lines) for (let gone = count - (now.get(text) ?? 0); gone > 0; gone--) textRemoved.push(text);
        lines.clear();
        for (const [text, count] of now) lines.set(text, count);
        mutated = false;
      }
    }
    if (moved.length || added.length || removed.length || textAdded.length || textRemoved.length) {
      state.frames.push({ t, moved, added, removed, textAdded, textRemoved });
      state.lastChange = t;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

type Step = { verb: string; target: string; text: string; label: string };

function parseStep(raw: string): Step {
  const [verb, ...rest] = raw.trim().split(/\s+/);
  const known = ["click", "hover", "fill", "press", "wait", "goto"];
  if (!known.includes(verb)) throw new Error(`Unknown step "${raw}". Steps start with one of: ${known.join(", ")}.`);
  if (verb === "fill") {
    // fill <selector> <text>: the selector is the first token, the rest is typed.
    return { verb, target: rest[0] ?? "", text: rest.slice(1).join(" "), label: raw };
  }
  return { verb, target: rest.join(" "), text: "", label: raw };
}

type PhaseResult = { name: string; items: Item[] };

// Requests and socket messages the page is still waiting for. Next's hot
// reload socket and analytics calls never carry the page's data.
type Activity = { pending: Map<object, number>; last: number };
const IGNORED_TRAFFIC = /\/_next\/(webpack-)?hmr|posthog|\/ingest\//;
// A request open longer than this is a long poll or a stream, not data the
// page is waiting for, and Firefox never reports some cancelled requests.
const LONG_PENDING_MS = 10_000;

/** Fails with a message instead of waiting forever on a page that stopped answering. */
function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  promise.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000} seconds.`)), ms);
  });
  // A finished check clears its limit, so the process can exit.
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

const read = <T>(page: import("@playwright/test").Page, expression: string) =>
  withTimeout(page.evaluate(expression) as Promise<T>, 10_000, `Reading the page (${expression})`);

/** Waits until nothing on the page has changed and no data is on its way for `quietMs`. */
async function settle(page: import("@playwright/test").Page, start: number, quietMs: number, activity: Activity): Promise<boolean> {
  const deadline = Date.now() + 20_000;
  await sleep(300);
  while (Date.now() < deadline) {
    const [lastChange, now] = await read<number[]>(page, "window.__verify.times()");
    const pageQuiet = now - Math.max(lastChange, start) >= quietMs;
    const waiting = [...activity.pending.values()].some((since) => Date.now() - since < LONG_PENDING_MS);
    const networkQuiet = !waiting && Date.now() - activity.last >= quietMs;
    if (pageQuiet && networkQuiet) return true;
    await sleep(200);
  }
  return false;
}

function describeMove(move: { dx: number; dy: number; dw: number; dh: number }): string {
  const parts: string[] = [];
  if (move.dy) parts.push(`moved ${move.dy > 0 ? "down" : "up"} ${Math.abs(Math.round(move.dy))}px`);
  if (move.dx) parts.push(`moved ${move.dx > 0 ? "right" : "left"} ${Math.abs(Math.round(move.dx))}px`);
  if (move.dh) parts.push(`${move.dh > 0 ? "grew" : "shrank"} ${Math.abs(Math.round(move.dh))}px ${move.dh > 0 ? "taller" : "shorter"}`);
  if (move.dw) parts.push(`${move.dw > 0 ? "grew" : "shrank"} ${Math.abs(Math.round(move.dw))}px ${move.dw > 0 ? "wider" : "narrower"}`);
  return parts.join(", ");
}

async function itemFor(page: import("@playwright/test").Page, finding: Finding, start: number): Promise<Item> {
  const when = `+${Math.round(finding.from - start)}ms`;
  const lasted = Math.round(finding.to - finding.from);
  const name = (id: number) => read<string>(page, `window.__verify.describe(${id})`);
  const key = (id: number) => read<string>(page, `window.__verify.key(${id})`);
  if (finding.kind === "shift") {
    // Compare by what moved visibly: a 1 or 2px nudge, such as a scrollbar
    // appearing, lands in a different frame on each site.
    const big = finding.moves.filter((move) => Math.max(Math.abs(move.dx), Math.abs(move.dy), Math.abs(move.dw), Math.abs(move.dh)) > 2);
    const keys = await Promise.all((big.length > 0 ? big : finding.moves).map((move) => key(move.id)));
    const shown = await Promise.all(finding.moves.slice(0, 5).map(async (move) => `${await name(move.id)} ${describeMove(move)}`));
    const more = finding.moves.length > 5 ? `; and ${finding.moves.length - 5} more` : "";
    return { kind: "shift", keys, line: `${when} layout shift: ${shown.join("; ")}${more}` };
  }
  if (finding.kind === "text-flash") return { kind: finding.kind, keys: [finding.text], line: `${when} text disappeared and came back ${lasted}ms later: "${finding.text}"` };
  if (finding.kind === "brief-text") return { kind: finding.kind, keys: [finding.text], line: `${when} text showed for only ${lasted}ms: "${finding.text}"` };
  return { kind: finding.kind, keys: [await key(finding.id)], line: `${when} element showed for only ${lasted}ms: ${await name(finding.id)}` };
}

/** Opens a URL, starting again if the page's own navigation (Clerk reloads after sign-in) interrupts it. */
async function open(page: import("@playwright/test").Page, url: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await page.goto(url);
    } catch (error) {
      if (attempt === 3 || !/NS_BINDING_ABORTED|interrupted by another navigation|frame was detached/i.test((error as Error).message)) throw error;
      await page.waitForLoadState("load").catch(() => {});
      await sleep(500);
    }
  }
}

async function signIn(page: import("@playwright/test").Page, url: string, email: string) {
  const { clerk } = await import("@clerk/testing/playwright");
  for (let attempt = 1; ; attempt++) {
    try {
      await open(page, url);
      await clerk.loaded({ page });
      await clerk.signIn({ page, emailAddress: email });
      break;
    } catch (error) {
      if (attempt === 2) {
        throw new Error(`Signing in as ${email} on ${url} failed twice: ${(error as Error).message.split("\n")[0]}. Clerk's development API is sometimes slow; run it again, or use --anon for a page that needs no account.`);
      }
    }
  }
  // The app reloads once the session exists; let that finish first.
  await sleep(500);
  await page.waitForLoadState("load");
}

// The verify user's own organization turns on every organization feature,
// so gated pages (extraction, Evidence Libraries, authors) open for it. Clerk
// syncs the organization's public metadata to Convex.
// The development Clerk instance has organization slugs turned off, so the
// organization is found by name.
const VERIFY_ORGANIZATION = { name: "Verify Agent", publicMetadata: { evidenceLibraries: true, authors: true, extraction: true } };

/** The verify user and its organization exist in the shared development Clerk instance; create them on first use. */
async function verifyUser(env: Record<string, string>, as?: string): Promise<string> {
  const { createClerkClient } = await import("@clerk/backend");
  const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
  if (as) {
    const existing = await clerk.users.getUserList({ emailAddress: [as], limit: 1 });
    if (existing.data.length === 0) throw new Error(`No Clerk user ${as} in the development instance.`);
    return as;
  }
  const user =
    (await clerk.users.getUserList({ emailAddress: [VERIFY_USER], limit: 1 })).data[0] ??
    (await clerk.users.createUser({ emailAddress: [VERIFY_USER], firstName: "Verify", lastName: "Agent", skipPasswordRequirement: true }));
  const memberships = await clerk.users.getOrganizationMembershipList({ userId: user.id, limit: 20 });
  const membership = memberships.data.find((entry) => entry.organization.name === VERIFY_ORGANIZATION.name);
  if (membership) {
    await clerk.organizations.updateOrganizationMetadata(membership.organization.id, { publicMetadata: VERIFY_ORGANIZATION.publicMetadata });
    return VERIFY_USER;
  }
  const found = (await clerk.organizations.getOrganizationList({ query: VERIFY_ORGANIZATION.name, limit: 10 })).data.find(
    (organization) => organization.name === VERIFY_ORGANIZATION.name,
  );
  if (found) {
    await clerk.organizations.createOrganizationMembership({ organizationId: found.id, userId: user.id, role: "org:admin" });
    await clerk.organizations.updateOrganizationMetadata(found.id, { publicMetadata: VERIFY_ORGANIZATION.publicMetadata });
  } else {
    await clerk.organizations.createOrganization({ ...VERIFY_ORGANIZATION, createdBy: user.id });
  }
  console.log(`Set up ${VERIFY_USER} in the "${VERIFY_ORGANIZATION.name}" organization. Give Clerk's webhook a few seconds to reach Convex.`);
  return VERIFY_USER;
}

type RunOptions = {
  steps: Step[];
  slow: number;
  quietMs: number;
  viewport: { width: number; height: number };
  allow: string;
  email: string | null;
  full: boolean;
  analyze: boolean;
};

const slug = (text: string) => text.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40) || "home";

/**
 * Loads the target on one site in one browser, runs the steps, and reports
 * what each phase showed. On the comparison site (`tolerant`) a step that
 * can't run, such as a click on a control the branch adds, ends the run there.
 */
async function runSite(
  browserName: string,
  origin: string,
  target: string,
  options: RunOptions,
  shotDir: string | null,
  tolerant: boolean,
): Promise<{ phases: PhaseResult[]; shots: string[]; stopped: string | null }> {
  const playwright = await import("@playwright/test");
  // Overlay scrollbars, as macOS shows them: a classic scrollbar appearing
  // when the page grows would move everything sideways in Firefox only.
  const browser = await (browserName === "firefox"
    ? playwright.firefox.launch({ firefoxUserPrefs: { "ui.useOverlayScrollbars": 1 } })
    : playwright.chromium.launch());
  const phases: PhaseResult[] = [];
  const shots: string[] = [];
  let stopped: string | null = null;
  let errors: Item[] = [];
  const activity: Activity = { pending: new Map(), last: Date.now() };
  const work = async () => {
    const context = await browser.newContext({ viewport: options.viewport });
    if (options.slow > 0) {
      // Data arrives late, the way it does on a slow connection, so a page
      // that only holds still on fast data shows it.
      await context.routeWebSocket(/\/api\/.*\/sync/, (socket) => {
        const remote = socket.connectToServer();
        remote.onMessage((message) => {
          const token = {};
          activity.pending.set(token, Date.now());
          setTimeout(() => {
            try {
              socket.send(message);
            } catch {
              // The page closed the socket; nothing is waiting for this message.
            } finally {
              activity.pending.delete(token);
              activity.last = Date.now();
            }
          }, options.slow);
        });
      });
      await context.route("**/*", (route) => {
        if (["fetch", "xhr"].includes(route.request().resourceType())) setTimeout(() => void route.continue().catch(() => {}), options.slow);
        else void route.continue();
      });
    }
    const page = await context.newPage();
    // Next prefetches linked pages in the background and Chromium never
    // reports some of those finished; they are not this page's data.
    const data = (request: import("@playwright/test").Request) => {
      const headers = request.headers();
      const prefetch = headers["next-router-prefetch"] !== undefined || headers["next-router-segment-prefetch"] !== undefined;
      return ["fetch", "xhr"].includes(request.resourceType()) && !prefetch && !IGNORED_TRAFFIC.test(request.url());
    };
    page.on("request", (request) => {
      if (!data(request)) return;
      activity.pending.set(request, Date.now());
      activity.last = Date.now();
    });
    const finished = (request: import("@playwright/test").Request) => {
      if (!activity.pending.delete(request)) return;
      activity.last = Date.now();
    };
    page.on("requestfinished", finished);
    page.on("requestfailed", finished);
    page.on("websocket", (socket) => {
      if (!IGNORED_TRAFFIC.test(socket.url())) socket.on("framereceived", () => (activity.last = Date.now()));
    });
    page.on("pageerror", (error) => {
      const message = error.message.split("\n")[0];
      errors.push({ kind: "error", keys: [message], line: `uncaught error: ${message}` });
    });
    if (options.email) await withTimeout(signIn(page, origin, options.email), 120_000, `Signing in on ${origin}`);
    await context.addInitScript(recorder, { allow: options.allow });

    const runPhase = async (phase: Phase, action: () => Promise<unknown>) => {
      errors = [];
      const response = (await action()) as import("@playwright/test").Response | null | undefined;
      const status = response && typeof response.status === "function" ? response.status() : 200;
      if (status >= 400) errors.push({ kind: "http", keys: [`http ${status}`], line: `the page answered HTTP ${status}` });
      const settled = await settle(page, phase.start, options.quietMs, activity);
      const { frames, parsed, baseline } = await read<{ frames: Frame[]; parsed: number | null; baseline: number | null }>(page, "window.__verify.take()");
      const items = [...errors];
      if (!settled) items.push({ kind: "settle", keys: ["settle"], line: "never settled: something kept changing for 20 seconds" });
      if (options.analyze) {
        // The comparison site starts counting at the parsed document, a little
        // earlier, so what this branch sees near the start is there to match.
        const start = tolerant ? parsed : baseline;
        const measured = phase.kind === "load" ? { ...phase, baseline: start ?? phase.start } : phase;
        for (const finding of analyzePhase(frames, measured)) items.push(await itemFor(page, finding, phase.start));
      }
      phases.push({ name: phase.name, items });
      if (shotDir) {
        const shot = path.join(shotDir, `${browserName}-${phases.length}-${slug(phase.name)}.png`);
        await page.screenshot({ path: shot, fullPage: options.full });
        shots.push(shot);
      }
    };

    try {
      stopped = `load ${target}`;
      await runPhase({ name: `load ${target}`, kind: "load", start: 0 }, () => withTimeout(open(page, origin + target), 90_000, `Opening ${origin}${target}`));
      stopped = null;
      for (const step of options.steps) {
        stopped = step.label;
        if (step.verb === "goto") {
          await runPhase({ name: step.label, kind: "load", start: 0 }, () => withTimeout(open(page, origin + step.target), 90_000, `Opening ${origin}${step.target}`));
        } else if (step.verb === "wait") {
          // Waiting only watches, so everything that moves during it counts.
          const start = await read<number>(page, "performance.now()");
          await runPhase({ name: step.label, kind: "load", start }, () => sleep(Number(step.target)));
        } else {
          const start = await read<number>(page, "performance.now()");
          await runPhase({ name: step.label, kind: "step", start }, async () => {
            const timeout = tolerant ? 10_000 : 15_000;
            try {
              if (step.verb === "click") await page.locator(step.target).first().click({ timeout });
              if (step.verb === "hover") await page.locator(step.target).first().hover({ timeout });
              if (step.verb === "fill") await page.locator(step.target).first().fill(step.text, { timeout });
              if (step.verb === "press") await page.keyboard.press(step.target);
            } catch (error) {
              throw new Error(`Step "${step.label}" failed on ${origin}${target}: ${(error as Error).message.split("\n")[0]}`);
            }
          });
        }
        stopped = null;
      }
    } catch (error) {
      if (!tolerant) throw error;
      stopped = `${stopped} (${(error as Error).message.split("\n")[0]})`;
    }
    if (options.email) await read(page, "window.Clerk && window.Clerk.signOut()").catch(() => {});
  };
  console.error(`Checking ${target} in ${browserName} on ${origin}`);
  try {
    await withTimeout(work(), 240_000, `Checking ${target} in ${browserName} on ${origin}`);
  } finally {
    await withTimeout(browser.close(), 30_000, "Closing the browser").catch(() => {});
  }
  return { phases, shots, stopped };
}

async function drive(target: string, values: Record<string, string | boolean | string[] | undefined>, mode: "shift" | "shot") {
  const server = await running();
  if (!server) throw new Error("Nothing is running from this worktree. Start it with `npm run verify -- up`.");
  if (!target.startsWith("/")) throw new Error("Give a path that starts with /, such as /results.");
  const env = ensureEnv();
  Object.assign(process.env, env, { CLERK_PUBLISHABLE_KEY: env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY });
  const browsers = ((values.browser as string | undefined) ?? (mode === "shift" ? "chromium,firefox" : "chromium")).split(",");
  const allowList = [...ALWAYS_ALLOWED, ...((values.allow as string[] | undefined) ?? [])];
  const email = values.anon === true ? null : await verifyUser(env, values.as as string | undefined);
  if (email) await (await import("@clerk/testing/playwright")).clerkSetup({ dotenv: false });
  const options: RunOptions = {
    steps: ((values.do as string[] | undefined) ?? []).map(parseStep),
    slow: Number(values.slow ?? (mode === "shift" ? 600 : 0)),
    quietMs: Number(values.quiet ?? 1_500),
    viewport: { width: Number(values.width ?? 1440), height: Number(values.height ?? 900) },
    allow: allowList.flatMap((selector) => [selector, `${selector} *`]).join(", "),
    email,
    full: values.full === true,
    analyze: mode === "shift",
  };
  // The same steps on the deployed dev site tell this branch's problems from
  // the ones dev already has. Both sites read the same Convex data.
  const baseOrigin = mode === "shift" && values.base !== "none" ? ((values.base as string | undefined) ?? process.env.VERIFY_BASE_URL ?? DEV_SITE) : null;

  const runDir = path.join(STATE, "runs", `${new Date().toISOString().replace(/[:.]/g, "-")}-${slug(target)}`);
  mkdirSync(runDir, { recursive: true });
  const runs = readdirSync(path.join(STATE, "runs")).sort();
  for (const old of runs.slice(0, Math.max(0, runs.length - 20))) rmSync(path.join(STATE, "runs", old), { recursive: true, force: true });

  const report: { browser: string; phase: string; line: string; onBase: boolean }[] = [];
  const shots: string[] = [];
  const notes: string[] = [];
  const baseSeen: { browser: string; phase: string; line: string }[] = [];
  for (const browserName of browsers) {
    const local = await runSite(browserName, server.url, target, options, runDir, false);
    shots.push(...local.shots);
    let known = local.phases.map((phase) => phase.items.map(() => false));
    const looks: Item[][][] = local.phases.map(() => []);
    // A run of the comparison site can miss a problem it has, by timing, so a
    // problem that still looks new gets a second look (knownAfterLooks keeps
    // the looks from adding up).
    for (let look = 1; baseOrigin && look <= 2 && known.some((phase) => phase.includes(false)); look++) {
      let base: Awaited<ReturnType<typeof runSite>>;
      try {
        base = await runSite(browserName, baseOrigin, target, options, null, true);
      } catch (error) {
        // A comparison run that breaks says nothing about this branch. Look
        // again; if that breaks too, everything stays counted as new.
        notes.push(`${browserName}: checking ${baseOrigin} failed (${(error as Error).message.split("\n")[0]}).`);
        continue;
      }
      for (const phase of base.phases) for (const item of phase.items) baseSeen.push({ browser: browserName, phase: `${phase.name} (look ${look})`, line: item.line });
      if (base.stopped && look === 1) notes.push(`${browserName}: ${baseOrigin} stopped at ${base.stopped}, so what follows counts as new.`);
      local.phases.forEach((_, index) => looks[index].push(base.phases[index]?.items ?? []));
      known = local.phases.map((phase, index) => knownAfterLooks(phase.items, looks[index]));
    }
    local.phases.forEach((phase, index) => {
      // An error page always fails, even where the comparison site errors too.
      phase.items.forEach((item, at) => report.push({ browser: browserName, phase: phase.name, line: item.line, onBase: item.kind !== "http" && known[index][at] }));
    });
  }

  const added = report.filter((entry) => !entry.onBase);
  const existing = report.filter((entry) => entry.onBase);
  writeJson(path.join(runDir, "report.json"), { target, base: baseOrigin, steps: options.steps.map((step) => step.label), browsers, slow: options.slow, added, existing, baseSeen, notes, shots });
  console.log(`Screenshots (look at them):\n${shots.map((shot) => `  ${shot}`).join("\n")}`);
  if (mode === "shot") return;
  for (const note of notes) console.log(note);
  if (existing.length > 0) {
    console.log(`${baseOrigin} has ${existing.length} of these too, so they are not from this branch:`);
    for (const entry of existing.slice(0, 10)) console.log(`  ${entry.browser}, ${entry.phase}: ${entry.line}`);
    if (existing.length > 10) console.log(`  and ${existing.length - 10} more in the report`);
  }
  if (added.length === 0) {
    writeJson(LAST_PASS, { at: Date.now(), head: git(["rev-parse", "HEAD"]), target, steps: options.steps.map((step) => step.label), browsers });
    console.log(`Pass: no ${baseOrigin ? "new " : ""}layout shifts, flashes or page errors in ${browsers.join(" and ")} on ${target}.`);
    return;
  }
  console.log(`Fail: ${added.length} problem${added.length === 1 ? "" : "s"}${baseOrigin ? ` that ${baseOrigin} doesn't have` : ""}:`);
  for (const entry of added) console.log(`  ${entry.browser}, ${entry.phase}: ${entry.line}`);
  console.log(`Report: ${path.join(runDir, "report.json")}`);
  process.exitCode = 1;
}

/** The files this branch changed against dev, committed or not, with when they last changed. */
function changedFiles(): { path: string; mtimeMs: number }[] {
  let base = "HEAD";
  try {
    base = git(["merge-base", "HEAD", "origin/dev"]);
  } catch {
    // No origin/dev here: compare with the last commit.
  }
  const names = new Set([...git(["diff", "--name-only", base]).split("\n"), ...git(["ls-files", "--others", "--exclude-standard"]).split("\n")]);
  // A deleted file has no time of its own; its folder changed when it went.
  const changedAt = (name: string) => {
    let target = path.join(ROOT, name);
    while (!existsSync(target)) target = path.dirname(target);
    return statSync(target).mtimeMs;
  };
  return [...names].filter(Boolean).map((name) => ({ path: name, mtimeMs: changedAt(name) }));
}

async function hookStop() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as { stop_hook_active?: boolean; transcript_path?: string | null };
  const transcript = input.transcript_path && existsSync(input.transcript_path) ? statSync(input.transcript_path) : null;
  const lastPass = readJson<{ at: number }>(LAST_PASS);
  const decision = stopDecision({
    stopHookActive: input.stop_hook_active === true,
    sessionStartMs: transcript ? transcript.birthtimeMs : 0,
    lastPassMs: lastPass?.at ?? null,
    changed: changedFiles(),
  });
  if (!decision.block) return;
  const listed = decision.files.slice(0, 8).join(", ") + (decision.files.length > 8 ? `, and ${decision.files.length - 8} more` : "");
  const reason = [
    `You changed user-facing files (${listed}) and no \`npm run verify -- shift\` has passed since.`,
    "Start the app with `npm run verify -- up` if it isn't running, then run `npm run verify -- shift <route>` for each route those files affect, with --do steps for the interactions you changed. Fix what it reports and look at the screenshots it lists.",
    'If nothing a person sees changed, or the user said not to test, record why with `npm run verify -- skip "<reason>"`.',
  ].join(" ");
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
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
  --browser <list>         chromium,firefox (shift default) or one of them.
  --slow <ms>              Delay for every server message (shift default 600, 0 to turn off).
  --allow <selector>       An element whose movement is intended, such as an expanding panel.
  --width <px> --height <px>  Viewport, default 1440x900. Use 390 x 844 for a phone.
  --as <email>             Sign in as this existing development user instead of the verify user.
  --anon                   Don't sign in.
  --full                   Full-page screenshots.
  --quiet <ms>             How long the page must hold still to count as settled (default 1500).
  --base <url|none>        The site to compare with (default https://dev.openscholar.ai).`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
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
    },
  });
  const [command, ...rest] = positionals;
  if (command === "up") return up(values);
  if (command === "down") return down();
  if (command === "status") return status();
  if (command === "shift" || command === "shot") return drive(rest[0] ?? "", values, command);
  if (command === "skip") {
    if (!rest.join(" ").trim()) throw new Error('Say why: npm run verify -- skip "<reason>".');
    writeJson(LAST_PASS, { at: Date.now(), head: git(["rev-parse", "HEAD"]), skipped: rest.join(" ") });
    console.log(`Recorded: ${rest.join(" ")}`);
    return;
  }
  if (command === "hook" && rest[0] === "stop") return hookStop();
  console.log(HELP);
  if (command) process.exitCode = 1;
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
