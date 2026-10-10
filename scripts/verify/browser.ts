// Drives one server in one browser for `npm run verify`: loads the target,
// runs the steps, and reports what each phase showed. OpenScholar and the
// Evidence Library run the same file; each passes its own `prepare` (signing
// in, answering a consent dialog). Keep the two in step.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { Browser, BrowserContext, Page, Request, Response, Route } from "@playwright/test";

import { analyzePhase, type Delta, type Finding, type Frame, type Item, type Phase } from "./analysis.ts";
import { recorder } from "./recorder.ts";
import { sleep, slug, withTimeout } from "./util.ts";

export type Step = { verb: string; target: string; text: string; label: string };

const STEP_VERBS = ["click", "hover", "fill", "press", "wait", "goto"];

/**
 * fill <selector> => <text> types the text after `=>` into the selector before
 * it, so the selector can hold spaces (role=textbox[name="Search terms"]).
 * Without `=>`, the selector is the first word and the rest is typed.
 */
function fillParts(rest: string): [string, string] {
  const arrow = rest.indexOf(" => ");
  if (arrow >= 0) return [rest.slice(0, arrow), rest.slice(arrow + 4)];
  const [target = "", ...text] = rest.split(" ");
  return [target, text.join(" ")];
}

export function parseStep(raw: string): Step {
  const [verb, ...rest] = raw.trim().split(/\s+/);
  if (!STEP_VERBS.includes(verb)) throw new Error(`Unknown step "${raw}". Steps start with one of: ${STEP_VERBS.join(", ")}.`);
  if (verb !== "fill") return { verb, target: rest.join(" "), text: "", label: raw };
  const [target, text] = fillParts(rest.join(" "));
  return { verb, target, text, label: raw };
}

/** With --early the first step is taken while the page loads, so it has to be one that acts on the page. */
export function earlyStep(steps: Step[]): Step {
  const [first] = steps;
  if (!first || first.verb === "goto" || first.verb === "wait") throw new Error("--early takes the first --do step early: give it one that clicks, hovers, presses or fills.");
  return first;
}

export type RunOptions = {
  steps: Step[];
  /** The first step runs as soon as its target answers clicks, before the page's data is in. */
  early: boolean;
  slow: number;
  quietMs: number;
  viewport: { width: number; height: number };
  allow: string;
  full: boolean;
  analyze: boolean;
  /** Gets the page ready before recording starts: signs in, answers a consent dialog. */
  prepare: (context: BrowserContext, page: Page, origin: string) => Promise<void>;
  /** Cleans up after the run, such as signing out, so sessions don't pile up. */
  finish?: (page: Page) => Promise<void>;
};

export type PhaseResult = { name: string; items: Item[] };
// `opened` counts the dialogs, sheets, popovers and menus that opened during the run.
export type SiteRun = { phases: PhaseResult[]; shots: string[]; stopped: string | null; opened: number };

// Requests and socket messages the page is still waiting for. Next's hot
// reload socket and analytics calls never carry the page's data.
type Activity = { pending: Map<object, number>; last: number };
const IGNORED_TRAFFIC = /\/_next\/(webpack-)?hmr|posthog|collector\.localhost|\/ingest\//;
// A request open longer than this is a long poll or a stream, not data the
// page is waiting for, and Firefox never reports some cancelled requests.
const LONG_PENDING_MS = 10_000;

const read = <T>(page: Page, expression: string) => withTimeout(page.evaluate(expression) as Promise<T>, 10_000, `Reading the page (${expression})`);

function waiting(activity: Activity, quietMs: number): boolean {
  const open = [...activity.pending.values()].some((since) => Date.now() - since < LONG_PENDING_MS);
  return open || Date.now() - activity.last < quietMs;
}

/** Waits until nothing on the page has changed and no data is on its way for `quietMs`. */
async function settle(page: Page, start: number, quietMs: number, activity: Activity): Promise<boolean> {
  const deadline = Date.now() + 20_000;
  await sleep(300);
  while (Date.now() < deadline) {
    const [lastChange, now] = await read<number[]>(page, "window.__verify.times()");
    if (now - Math.max(lastChange, start) >= quietMs && !waiting(activity, quietMs)) return true;
    await sleep(200);
  }
  return false;
}

const MOVE_WORDS: { side: keyof Delta; more: string; less: string }[] = [
  { side: "dy", more: "moved down {n}px", less: "moved up {n}px" },
  { side: "dx", more: "moved right {n}px", less: "moved left {n}px" },
  { side: "dh", more: "grew {n}px taller", less: "shrank {n}px shorter" },
  { side: "dw", more: "grew {n}px wider", less: "shrank {n}px narrower" },
];

function describeMove(move: Delta): string {
  return MOVE_WORDS.filter(({ side }) => move[side])
    .map(({ side, more, less }) => (move[side] > 0 ? more : less).replace("{n}", String(Math.abs(Math.round(move[side])))))
    .join(", ");
}

const visible = (move: Delta) => Math.max(Math.abs(move.dx), Math.abs(move.dy), Math.abs(move.dw), Math.abs(move.dh)) > 2;

async function shiftItem(page: Page, finding: Extract<Finding, { kind: "shift" }>, when: string): Promise<Item> {
  // Compare by what moved visibly: a 1 or 2px nudge, such as a scrollbar
  // appearing, lands in a different frame on each site.
  const big = finding.moves.filter(visible);
  const named = big.length > 0 ? big : finding.moves;
  const keys = await Promise.all(named.map((move) => read<string>(page, `window.__verify.key(${move.id})`)));
  const shown = await Promise.all(finding.moves.slice(0, 5).map(async (move) => `${await read<string>(page, `window.__verify.describe(${move.id})`)} ${describeMove(move)}`));
  const more = finding.moves.length > 5 ? `; and ${finding.moves.length - 5} more` : "";
  const deltas = named.map(({ dx, dy, dw, dh }) => ({ dx, dy, dw, dh }));
  return { kind: "shift", keys, deltas, line: `${when} layout shift: ${shown.join("; ")}${more}` };
}

const TEXT_LINES: Record<string, (text: string, lasted: number) => string> = {
  "text-flash": (text, lasted) => `text disappeared and came back ${lasted}ms later: "${text}"`,
  "brief-text": (text, lasted) => `text showed for only ${lasted}ms: "${text}"`,
};

async function itemFor(page: Page, finding: Finding, start: number): Promise<Item> {
  const when = `+${Math.round(finding.from - start)}ms`;
  const lasted = Math.round(finding.to - finding.from);
  if (finding.kind === "shift") return shiftItem(page, finding, when);
  if (finding.kind === "brief-element" || finding.kind === "late-content") {
    const [key, name] = await Promise.all([read<string>(page, `window.__verify.key(${finding.id})`), read<string>(page, `window.__verify.describe(${finding.id})`)]);
    const line = finding.kind === "brief-element" ? `${when} element showed for only ${lasted}ms: ${name}` : `+${Math.round(finding.to - start)}ms popped in ${lasted}ms after its dialog opened, without fading in: ${name}`;
    return { kind: finding.kind, keys: [key], line };
  }
  return { kind: finding.kind, keys: [finding.text], line: `${when} ${TEXT_LINES[finding.kind](finding.text, lasted)}` };
}

const INTERRUPTED = /NS_BINDING_ABORTED|interrupted by another navigation|frame was detached/i;

/** Opens a URL, starting again if the page's own navigation (a reload after signing in) interrupts it. */
export async function open(page: Page, url: string, attempt = 1): Promise<Response | null> {
  try {
    return await page.goto(url);
  } catch (error) {
    if (attempt === 3 || !INTERRUPTED.test((error as Error).message)) throw error;
    await page.waitForLoadState("load").catch(() => {});
    await sleep(500);
    return open(page, url, attempt + 1);
  }
}

/** Delays one message or request by `slow`, keeping it counted as pending until it goes through. */
function delay(activity: Activity, slow: number, send: () => unknown) {
  const token = {};
  activity.pending.set(token, Date.now());
  setTimeout(() => {
    try {
      send();
    } catch {
      // The page closed the socket or the request; nothing waits for it.
    } finally {
      activity.pending.delete(token);
      activity.last = Date.now();
    }
  }, slow);
}

/** Data arrives late, the way it does on a slow connection, so a page that only holds still on fast data shows it. */
async function slowDown(context: BrowserContext, slow: number, activity: Activity) {
  await context.routeWebSocket(/\/api\/.*\/sync/, (socket) => {
    const remote = socket.connectToServer();
    remote.onMessage((message) => delay(activity, slow, () => socket.send(message)));
  });
  await context.route("**/*", (route) => {
    if (["fetch", "xhr"].includes(route.request().resourceType())) setTimeout(() => void route.fallback().catch(() => {}), slow);
    else void route.fallback();
  });
}

const FONT_CACHE = path.join(homedir(), ".cache", "verify-fonts");
const WEB_FONTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

async function saveFont(route: Route, file: string) {
  const response = await route.fetch();
  if (!response.ok()) return route.fulfill({ response });
  const headers = { "content-type": response.headers()["content-type"] ?? "application/octet-stream", "access-control-allow-origin": "*" };
  writeFileSync(file, JSON.stringify({ status: response.status(), headers, body: (await response.body()).toString("base64") }));
}

async function serveFont(route: Route, browserName: string) {
  const file = path.join(FONT_CACHE, createHash("sha1").update(`${browserName} ${route.request().url()}`).digest("hex"));
  if (!existsSync(file)) await saveFont(route, file);
  if (!existsSync(file)) return;
  const saved = JSON.parse(readFileSync(file, "utf8"));
  await route.fulfill({ status: saved.status, headers: saved.headers, body: Buffer.from(saved.body, "base64") });
}

/**
 * Web fonts come from a disk cache after their first download, so they load at
 * once and at the same moment on both servers: a slow font server would
 * otherwise push the baseline past the changes being checked.
 */
export async function cacheFonts(context: BrowserContext, browserName: string) {
  mkdirSync(FONT_CACHE, { recursive: true });
  await context.route(WEB_FONTS, (route) => serveFont(route, browserName));
}

// Next prefetches linked pages in the background and Chromium never reports
// some of those finished; they are not this page's data.
function isData(request: Request): boolean {
  const headers = request.headers();
  const prefetch = headers["next-router-prefetch"] !== undefined || headers["next-router-segment-prefetch"] !== undefined;
  return ["fetch", "xhr"].includes(request.resourceType()) && !prefetch && !IGNORED_TRAFFIC.test(request.url());
}

/** An action whose request fails can still leave a page that looks fine. */
function serverError(response: Response, origin: string): Item | null {
  const request = response.request();
  const url = new URL(request.url());
  if (response.status() < 500 || !["fetch", "xhr"].includes(request.resourceType()) || url.origin !== new URL(origin).origin) return null;
  return { kind: "http", keys: [`http ${response.status()} ${url.pathname}`], line: `a request to ${url.pathname} answered HTTP ${response.status()}` };
}

/** Counts the page's data requests as pending until they finish, and collects errors into `errors`. */
function watch(page: Page, origin: string, activity: Activity, errors: Item[]) {
  page.on("request", (request) => {
    if (!isData(request)) return;
    activity.pending.set(request, Date.now());
    activity.last = Date.now();
  });
  const finished = (request: Request) => {
    if (activity.pending.delete(request)) activity.last = Date.now();
  };
  page.on("requestfinished", finished);
  page.on("requestfailed", finished);
  page.on("websocket", (socket) => {
    if (!IGNORED_TRAFFIC.test(socket.url())) socket.on("framereceived", () => (activity.last = Date.now()));
  });
  page.on("response", (response) => {
    const item = serverError(response, origin);
    if (item) errors.push(item);
  });
  page.on("pageerror", (error) => {
    const message = error.message.split("\n")[0];
    errors.push({ kind: "error", keys: [message], line: `uncaught error: ${message}` });
  });
}

type Session = { page: Page; origin: string; target: string; options: RunOptions; activity: Activity; errors: Item[]; run: SiteRun; shotDir: string | null; browserName: string; tolerant: boolean };

function pageStatus(response: unknown): number {
  return response && typeof (response as Response).status === "function" ? (response as Response).status() : 200;
}

type Recording = { frames: Frame[]; baseline: number | null };

/**
 * Where a load phase starts watching: this branch from the baseline (document
 * parsed, fonts loaded), the comparison server from navigation. Hydration can
 * land either side of the baseline, so the comparison counts everything this
 * branch might report.
 */
function watchedFrom(phase: Phase, recording: Recording, tolerant: boolean): Phase {
  if (phase.kind !== "load" || tolerant) return phase;
  return { ...phase, baseline: recording.baseline ?? phase.start };
}

async function findings(session: Session, phase: Phase): Promise<Item[]> {
  const recording = await read<Recording>(session.page, "window.__verify.take()");
  session.run.opened += recording.frames.reduce((count, frame) => count + (frame.opened?.length ?? 0), 0);
  if (!session.options.analyze) return [];
  const found = analyzePhase(recording.frames, watchedFrom(phase, recording, session.tolerant));
  return Promise.all(found.map((finding) => itemFor(session.page, finding, phase.start)));
}

async function screenshot(session: Session, name: string) {
  if (!session.shotDir) return;
  const shot = path.join(session.shotDir, `${session.browserName}-${session.run.phases.length}-${slug(name)}.png`);
  await session.page.screenshot({ path: shot, fullPage: session.options.full });
  session.run.shots.push(shot);
}

async function runPhase(session: Session, phase: Phase, action: () => Promise<unknown>) {
  session.errors.length = 0;
  const status = pageStatus(await action());
  if (status >= 400) session.errors.push({ kind: "http", keys: [`http ${status}`], line: `the page answered HTTP ${status}` });
  const settled = await settle(session.page, phase.start, session.options.quietMs, session.activity);
  const items = [...session.errors];
  if (!settled) items.push({ kind: "settle", keys: ["settle"], line: "never settled: something kept changing for 20 seconds" });
  items.push(...(await findings(session, phase)));
  session.run.phases.push({ name: phase.name, items });
  await screenshot(session, phase.name);
}

const ACTIONS: Record<string, (page: Page, step: Step, timeout: number) => Promise<unknown>> = {
  click: (page, step, timeout) => page.locator(step.target).first().click({ timeout }),
  hover: (page, step, timeout) => page.locator(step.target).first().hover({ timeout }),
  fill: (page, step, timeout) => page.locator(step.target).first().fill(step.text, { timeout }),
  press: (page, step) => page.keyboard.press(step.target),
};

const act = (page: Page, step: Step, timeout: number) => ACTIONS[step.verb](page, step, timeout);

const loadPhase = (session: Session, name: string, route: string) =>
  runPhase(session, { name, kind: "load", start: 0 }, () => withTimeout(open(session.page, session.origin + route), 90_000, `Opening ${session.origin}${route}`));

async function runStep(session: Session, step: Step) {
  if (step.verb === "goto") return loadPhase(session, step.label, step.target);
  const start = await read<number>(session.page, "performance.now()");
  // Waiting only watches, so everything that moves during it counts.
  if (step.verb === "wait") return runPhase(session, { name: step.label, kind: "load", start }, () => sleep(Number(step.target)));
  return runPhase(session, { name: step.label, kind: "step", start }, () =>
    act(session.page, step, session.tolerant ? 10_000 : 15_000).catch((error: Error) => {
      throw new Error(`Step "${step.label}" failed on ${session.origin}${session.target}: ${error.message.split("\n")[0]}`);
    }),
  );
}

/** Waits until React answers events on the step's target: until then a click does nothing. */
const answers = (page: Page, step: Step, timeout: number) =>
  page.locator(step.target).first().evaluate(
    (element) =>
      new Promise<void>((resolve) => {
        const check = () => (Object.keys(element).some((key) => key.startsWith("__reactProps$")) ? resolve() : requestAnimationFrame(check));
        check();
      }),
    undefined,
    { timeout },
  );

/**
 * Opens the page and takes the step at once, the way someone clicks a button
 * before the page's data has arrived. The load isn't waited for or judged:
 * only what the step opens is.
 */
async function earlyPhase(session: Session, step: Step) {
  const timeout = session.tolerant ? 10_000 : 15_000;
  session.run.stopped = step.label;
  await runPhase(session, { name: `early ${step.label}`, kind: "early", start: 0 }, async () => {
    const response = await withTimeout(open(session.page, session.origin + session.target), 90_000, `Opening ${session.origin}${session.target}`);
    await answers(session.page, step, timeout)
      .then(() => act(session.page, step, timeout))
      .catch((error: Error) => {
        throw new Error(`Step "${step.label}" failed early on ${session.origin}${session.target}: ${error.message.split("\n")[0]}`);
      });
    return response;
  });
}

async function runAll(session: Session) {
  const { early, steps } = session.options;
  session.run.stopped = `load ${session.target}`;
  if (early) await earlyPhase(session, earlyStep(steps));
  else await loadPhase(session, `load ${session.target}`, session.target);
  for (const step of early ? steps.slice(1) : steps) {
    session.run.stopped = step.label;
    await runStep(session, step);
  }
  session.run.stopped = null;
}

async function launch(browserName: string): Promise<Browser> {
  const playwright = await import("@playwright/test");
  // Overlay scrollbars, as macOS shows them: a classic scrollbar appearing
  // when the page grows would move everything sideways in Firefox only.
  if (browserName === "firefox") return playwright.firefox.launch({ firefoxUserPrefs: { "ui.useOverlayScrollbars": 1 } });
  return playwright.chromium.launch();
}

async function work(browser: Browser, session: Omit<Session, "page">): Promise<void> {
  const context = await browser.newContext({ viewport: session.options.viewport });
  await cacheFonts(context, session.browserName);
  const page = await context.newPage();
  await session.options.prepare(context, page, session.origin);
  if (session.options.slow > 0) await slowDown(context, session.options.slow, session.activity);
  watch(page, session.origin, session.activity, session.errors);
  // tsx keeps function names by wrapping them in a __name helper, which the
  // recorder carries into the page; the page needs it too.
  await context.addInitScript({ content: "globalThis.__name ??= (target) => target;" });
  await context.addInitScript(recorder, { allow: session.options.allow });
  try {
    await runAll({ ...session, page });
  } catch (error) {
    // On the comparison server a step that can't run, such as a click on a
    // control the branch adds, ends the run there.
    if (!session.tolerant) throw error;
    session.run.stopped = `${session.run.stopped} (${(error as Error).message.split("\n")[0]})`;
  } finally {
    // Signing out can navigate the page, and a page that navigates away can leave the call waiting.
    if (session.options.finish) await withTimeout(session.options.finish(page), 10_000, "Cleaning up after the run").catch(() => {});
  }
}

/** Loads the target on one server in one browser, runs the steps, and reports what each phase showed. */
export async function runSite(browserName: string, origin: string, target: string, options: RunOptions, shotDir: string | null, tolerant: boolean): Promise<SiteRun> {
  const browser = await launch(browserName);
  const run: SiteRun = { phases: [], shots: [], stopped: null, opened: 0 };
  const what = `Checking ${target} in ${browserName} on ${origin}`;
  console.error(what);
  try {
    await withTimeout(work(browser, { origin, target, options, activity: { pending: new Map(), last: Date.now() }, errors: [], run, shotDir, browserName, tolerant }), 240_000, what);
  } finally {
    await withTimeout(browser.close(), 30_000, "Closing the browser").catch(() => {});
  }
  return run;
}
