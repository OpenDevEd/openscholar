// What `npm run verify` decides from what a browser recorded. The recorder in
// cli.ts sends one Frame per animation frame in which something changed:
// elements whose layout box moved or resized (transforms excluded, so a
// fade or slide is never a shift), elements added or removed, and lines of
// visible text added or removed.

export type Move = { id: number; dx: number; dy: number; dw: number; dh: number };

// A layout box: x, y, width, height.
export type Box = [number, number, number, number];

export type Frame = {
  t: number;
  moved: Move[];
  added: { id: number; box: Box }[];
  removed: { id: number; box: Box }[];
  textAdded: string[];
  textRemoved: string[];
};

// A load phase starts with navigation; everything after `baseline` (fonts
// ready, document parsed) must hold still. A step phase starts with an action;
// its first burst of change is the response to the action.
export type Phase = { name: string; kind: "load" | "step"; start: number; baseline?: number };

export type Finding =
  | { kind: "shift"; from: number; to: number; moves: Move[] }
  | { kind: "text-flash"; text: string; from: number; to: number }
  | { kind: "brief-text"; text: string; from: number; to: number }
  | { kind: "brief-element"; id: number; from: number; to: number };

// Frames closer than this belong to one burst, such as one animated resize.
const BURST_GAP_MS = 120;
// Text that comes back within this long flashed instead of changing.
const FLASH_RETURN_MS = 2_000;
// Text or an element shown for less than this was a blink, not a state.
const BRIEF_MS = 400;
// Elements smaller than this (a 20×20 icon) are too small to read as a flash.
const MIN_FLASH_AREA = 400;

const sameBox = (a: Box, b: Box) => a.every((value, index) => Math.abs(value - b[index]) <= 2);

function changed(frame: Frame): boolean {
  return frame.moved.length > 0 || frame.added.length > 0 || frame.removed.length > 0 || frame.textAdded.length > 0 || frame.textRemoved.length > 0;
}

function bursts(frames: Frame[]): Frame[][] {
  const groups: Frame[][] = [];
  for (const frame of frames) {
    const last = groups.at(-1);
    if (last && frame.t - last.at(-1)!.t <= BURST_GAP_MS) last.push(frame);
    else groups.push([frame]);
  }
  return groups;
}

function shift(frames: Frame[]): Finding | null {
  const moves = new Map<number, Move>();
  for (const frame of frames) {
    for (const move of frame.moved) {
      const total = moves.get(move.id) ?? { id: move.id, dx: 0, dy: 0, dw: 0, dh: 0 };
      moves.set(move.id, { id: move.id, dx: total.dx + move.dx, dy: total.dy + move.dy, dw: total.dw + move.dw, dh: total.dh + move.dh });
    }
  }
  const moving = frames.filter((frame) => frame.moved.length > 0);
  if (moving.length === 0) return null;
  return { kind: "shift", from: moving[0].t, to: moving.at(-1)!.t, moves: [...moves.values()] };
}

function blinks(frames: Frame[], since: number): Finding[] {
  const findings: Finding[] = [];
  const count = new Map<string, number>();
  const shownAt = new Map<string, number[]>();
  const goneAt = new Map<string, number[]>();
  for (const frame of frames) {
    for (const text of frame.textRemoved) {
      count.set(text, (count.get(text) ?? 0) - 1);
      const shown = shownAt.get(text)?.pop();
      if (shown !== undefined && shown >= since && frame.t - shown < BRIEF_MS) findings.push({ kind: "brief-text", text, from: shown, to: frame.t });
      if (frame.t >= since) goneAt.set(text, [...(goneAt.get(text) ?? []), frame.t]);
    }
    for (const text of frame.textAdded) {
      count.set(text, (count.get(text) ?? 0) + 1);
      const gone = goneAt.get(text)?.shift();
      if (gone !== undefined && frame.t - gone <= FLASH_RETURN_MS) findings.push({ kind: "text-flash", text, from: gone, to: frame.t });
      shownAt.set(text, [...(shownAt.get(text) ?? []), frame.t]);
    }
  }

  // Text hidden and then shown again is one flash, not also a blink.
  const flashes = findings.filter((finding) => finding.kind === "text-flash");
  const kept = findings.filter(
    (finding) => finding.kind !== "brief-text" || !flashes.some((flash) => flash.kind === "text-flash" && flash.text === finding.text && flash.from === finding.to),
  );

  const born = new Map<number, number>();
  for (const frame of frames) {
    for (const element of frame.added) born.set(element.id, frame.t);
    for (const { id, box } of frame.removed) {
      const birth = born.get(id);
      born.delete(id);
      if (birth === undefined || birth < since || box[2] * box[3] < MIN_FLASH_AREA || frame.t - birth >= BRIEF_MS) continue;
      // A placeholder swapped for content in the same place never left the area blank.
      if (frame.added.some((element) => sameBox(element.box, box))) continue;
      kept.push({ kind: "brief-element", id, from: birth, to: frame.t });
    }
  }
  return kept;
}

/** The problems a person would see in one phase: movement after the page or the response settled, and blinks. */
export function analyzePhase(frames: Frame[], phase: Phase): Finding[] {
  const since = phase.kind === "load" ? (phase.baseline ?? phase.start) : phase.start;
  const watched = frames.filter((frame) => frame.t >= since && changed(frame));
  const groups = bursts(watched);
  // After an action, the first burst is the response (a dialog opening, a row
  // growing as it animates). Anything that moves after it moved on its own.
  const late = phase.kind === "step" ? groups.slice(1) : groups;
  const shifts = late.map(shift).filter((finding): finding is Finding => finding !== null);
  return [...shifts, ...blinks(frames, since)].sort((a, b) => a.from - b.from || a.kind.localeCompare(b.kind));
}

// Files a person sees. Route handlers and other .ts files under app/ are not.
const USER_FACING = /^(app|components)\/.+\.(tsx|css)$/;

/**
 * Whether the stop hook keeps an agent working: a user-facing file changed
 * during this session and no `verify` pass or recorded skip is newer than it.
 */
export function stopDecision(input: {
  stopHookActive: boolean;
  sessionStartMs: number;
  lastPassMs: number | null;
  changed: { path: string; mtimeMs: number }[];
}): { block: false } | { block: true; files: string[] } {
  if (input.stopHookActive) return { block: false };
  const files = input.changed
    .filter((file) => USER_FACING.test(file.path) && file.mtimeMs > input.sessionStartMs && file.mtimeMs > (input.lastPassMs ?? 0))
    .map((file) => file.path);
  return files.length > 0 ? { block: true, files } : { block: false };
}

// One thing to report: its kind, the keys that identify it on another site
// (element keys or text, never positions or timing), and the line to print.
export type Item = { kind: string; keys: string[]; line: string };

/**
 * Which of this branch's problems the comparison site has too. A problem is
 * known when every element or text it names also appears in a problem of the
 * same kind there, so a new jump that lands in the same frame as an old one
 * still counts. Each problem there also vouches for at most one here, matched
 * when at least half of what the two name is the same, so one extra jump on
 * this branch stays new even if it moves elements that already jump there.
 */
export function matchKnown(local: Item[], base: Item[]): boolean[] {
  // Keys are counted, not just collected: repeated cards share a key, and two
  // of them moving here is not one of them moving there.
  const tally = (keys: string[]) => keys.reduce((counts, key) => counts.set(key, (counts.get(key) ?? 0) + 1), new Map<string, number>());
  const seen = new Map<string, number>();
  for (const item of base) for (const [key, count] of tally(item.keys)) seen.set(`${item.kind}|${key}`, (seen.get(`${item.kind}|${key}`) ?? 0) + count);
  const used = new Set<number>();
  return local.map((item) => {
    const counts = tally(item.keys);
    if ([...counts].some(([key, count]) => (seen.get(`${item.kind}|${key}`) ?? 0) < count)) return false;
    let best = -1;
    let bestScore = 0.5;
    base.forEach((candidate, index) => {
      if (used.has(index) || candidate.kind !== item.kind) return;
      const other = tally(candidate.keys);
      let shared = 0;
      let union = 0;
      for (const key of new Set([...counts.keys(), ...other.keys()])) {
        shared += Math.min(counts.get(key) ?? 0, other.get(key) ?? 0);
        union += Math.max(counts.get(key) ?? 0, other.get(key) ?? 0);
      }
      const score = shared / union;
      if (score >= bestScore) {
        best = index;
        bestScore = score;
      }
    });
    if (best === -1) return false;
    used.add(best);
    return true;
  });
}

/**
 * What several looks at the comparison site vouch for together: the single
 * look that vouches for the most. Looks never add up, so a problem seen once
 * there can't vouch for two here by being seen again on a second look.
 */
export function knownAfterLooks(local: Item[], looks: Item[][]): boolean[] {
  let best = local.map(() => false);
  for (const look of looks) {
    const matched = matchKnown(local, look);
    if (matched.filter(Boolean).length > best.filter(Boolean).length) best = matched;
  }
  return best;
}
