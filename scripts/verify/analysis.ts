// What `npm run verify` decides from what a browser recorded. The recorder
// sends one Frame per animation frame in which something changed: elements
// whose layout box moved or resized (transforms excluded, so a fade or slide
// is never a shift), elements added or removed, and lines of visible text
// added or removed.
//
// OpenScholar and the Evidence Library run the same file (scripts/verify in
// OpenDevEd/openalex-count, tools/verify in OpenDevEd/new-el); keep them in step.

export type Delta = { dx: number; dy: number; dw: number; dh: number };
export type Move = Delta & { id: number };

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

const changed = (frame: Frame) =>
  [frame.moved, frame.added, frame.removed, frame.textAdded, frame.textRemoved].some((list) => list.length > 0);

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
  for (const move of frames.flatMap((frame) => frame.moved)) {
    const total = moves.get(move.id) ?? { id: move.id, dx: 0, dy: 0, dw: 0, dh: 0 };
    moves.set(move.id, { id: move.id, dx: total.dx + move.dx, dy: total.dy + move.dy, dw: total.dw + move.dw, dh: total.dh + move.dh });
  }
  const moving = frames.filter((frame) => frame.moved.length > 0);
  if (moving.length === 0) return null;
  return { kind: "shift", from: moving[0].t, to: moving.at(-1)!.t, moves: [...moves.values()] };
}

/** Lines of text shown and hidden over the phase, oldest first, so each change pairs with the one before it. */
type TextHistory = { shownAt: Map<string, number[]>; goneAt: Map<string, number[]> };

function textGone(history: TextHistory, text: string, t: number, since: number): Finding[] {
  const shown = history.shownAt.get(text)?.pop();
  if (t >= since) history.goneAt.set(text, [...(history.goneAt.get(text) ?? []), t]);
  return shown !== undefined && shown >= since && t - shown < BRIEF_MS ? [{ kind: "brief-text", text, from: shown, to: t }] : [];
}

function textShown(history: TextHistory, text: string, t: number): Finding[] {
  const gone = history.goneAt.get(text)?.shift();
  history.shownAt.set(text, [...(history.shownAt.get(text) ?? []), t]);
  return gone !== undefined && t - gone <= FLASH_RETURN_MS ? [{ kind: "text-flash", text, from: gone, to: t }] : [];
}

// A line with its numbers blanked. A number counting up or down changes its
// line every frame: the same words with new numbers is one line changing its
// value, not text blinking.
const words = (text: string) => text.replace(/\d+(?:[.,]\d+)*/g, "0");
const besides = (lines: string[], others: string[]) => {
  const counting = new Set(others.map(words));
  return lines.filter((text) => !counting.has(words(text)));
};

function textBlinks(frames: Frame[], since: number): Finding[] {
  const history: TextHistory = { shownAt: new Map(), goneAt: new Map() };
  const findings = frames.flatMap((frame) => [
    ...besides(frame.textRemoved, frame.textAdded).flatMap((text) => textGone(history, text, frame.t, since)),
    ...besides(frame.textAdded, frame.textRemoved).flatMap((text) => textShown(history, text, frame.t)),
  ]);
  // Text hidden and then shown again is one flash, not also a blink.
  const flashes = findings.filter((finding) => finding.kind === "text-flash");
  const partOfFlash = (finding: Finding) => flashes.some((flash) => flash.kind === "text-flash" && finding.kind === "brief-text" && flash.text === finding.text && flash.from === finding.to);
  return findings.filter((finding) => !partOfFlash(finding));
}

function elementBlinks(frames: Frame[], since: number): Finding[] {
  const born = new Map<number, number>();
  const findings: Finding[] = [];
  for (const frame of frames) {
    for (const element of frame.added) born.set(element.id, frame.t);
    for (const { id, box } of frame.removed) {
      const birth = born.get(id);
      born.delete(id);
      if (birth === undefined || birth < since || box[2] * box[3] < MIN_FLASH_AREA || frame.t - birth >= BRIEF_MS) continue;
      // A placeholder swapped for content in the same place never left the area blank.
      if (!frame.added.some((element) => sameBox(element.box, box))) findings.push({ kind: "brief-element", id, from: birth, to: frame.t });
    }
  }
  return findings;
}

/** The problems a person would see in one phase: movement after the page or the response settled, and blinks. */
export function analyzePhase(frames: Frame[], phase: Phase): Finding[] {
  const since = phase.kind === "load" ? (phase.baseline ?? phase.start) : phase.start;
  const groups = bursts(frames.filter((frame) => frame.t >= since && changed(frame)));
  // After an action, the first burst is the response (a dialog opening, a row
  // growing as it animates). Anything that moves after it moved on its own.
  const late = phase.kind === "step" ? groups.slice(1) : groups;
  const shifts = late.map(shift).filter((finding): finding is Finding => finding !== null);
  return [...shifts, ...textBlinks(frames, since), ...elementBlinks(frames, since)].sort((a, b) => a.from - b.from || a.kind.localeCompare(b.kind));
}

/**
 * Whether the stop hook keeps an agent working: a file a person sees
 * (`userFacing`) changed during this session and no `verify` pass or
 * recorded skip is newer than it.
 */
export function stopDecision(input: {
  stopHookActive: boolean;
  sessionStartMs: number;
  lastPassMs: number | null;
  changed: { path: string; mtimeMs: number }[];
  userFacing: RegExp;
}): { block: false } | { block: true; files: string[] } {
  if (input.stopHookActive) return { block: false };
  const since = Math.max(input.sessionStartMs, input.lastPassMs ?? 0);
  const files = input.changed.filter((file) => input.userFacing.test(file.path) && file.mtimeMs > since).map((file) => file.path);
  return files.length > 0 ? { block: true, files } : { block: false };
}

// One thing to report: its kind, what identifies it on another site (element
// keys or text, never positions or timing), and the line to print. A shift
// also says how each element it names moved, in the same order as its keys.
export type Item = { kind: string; keys: string[]; line: string; deltas?: Delta[] };

type Sides = [number, number, number, number];
const sides = (delta: Delta): Sides => [delta.dx, delta.dy, delta.dw, delta.dh];
const moved = (value: number) => Math.abs(value) >= 1;

// A side of an element's box moved the same way here and there when it went
// the same direction by about as much: within 4px, or a quarter of the move.
const sameWay = (a: number, b: number) => Math.sign(Math.round(a)) === Math.sign(Math.round(b)) && Math.abs(a - b) <= Math.max(4, Math.max(Math.abs(a), Math.abs(b)) / 4);
// Each side that moved here is matched there; the sides that didn't move here
// can belong to another of this branch's problems, landing in another frame.
const takes = (piece: Sides, left: Sides) => piece.every((value, index) => !moved(value) || sameWay(value, left[index]));

// A few pixels of a move land differently on each site: the last 4px of a
// growth can come after the baseline here and before it there. Such a piece
// needs what is left of the site's move to go the same way, at least as far.
const fragment = (delta: Sides | null) => !!delta && delta.every((value) => Math.abs(value) <= 4);
const within = (piece: number, whole: number) => Math.round(piece) === 0 || (Math.sign(piece) === Math.sign(whole) && Math.abs(piece) <= Math.abs(whole));
const partOf = (piece: Sides, left: Sides) => piece.every((value, index) => within(value, left[index]));

// An element movement, text or error the comparison site showed. A movement
// keeps what is left of it on each side once moves here are matched to it.
type Vouch = { key: string; kind: string; move: Sides | null; left: Sides | null; used: boolean };

/** Everything the comparison site showed in a phase, one entry per element moved or text and problem seen. */
function vouchers(base: Item[]): Vouch[] {
  return base.flatMap((item) =>
    item.keys.map((key, index) => {
      const delta = item.deltas?.[index];
      const move = delta ? sides(delta) : null;
      return { key, kind: item.kind, move, left: move, used: false };
    }),
  );
}

/** Whether this entry there can vouch for this element or text here. */
function fits(entry: Vouch, kind: string, key: string, delta: Sides | null): boolean {
  if (entry.kind !== kind || entry.key !== key) return false;
  if (!delta || !entry.move) return !entry.used;
  if (entry.used) return false;
  return fragment(delta) ? partOf(delta, entry.left!) : takes(delta, entry.left!);
}

/** Uses up as much of the entry as this element moved here; returns how to give it back. */
function take(entry: Vouch, delta: Sides | null): () => void {
  const before = { left: entry.left, used: entry.used };
  entry.left = delta && entry.left ? (entry.left.map((value, index) => (moved(delta[index]) ? value - delta[index] : value)) as Sides) : entry.left;
  entry.used = !entry.left || !entry.left.some(moved);
  return () => Object.assign(entry, before);
}

// How many sides an entry moved that this move here didn't: the closest fit
// leaves the entries that also moved other sides for the moves that need them.
const extraSides = (entry: Vouch, delta: Sides | null) => (entry.left && delta ? entry.left.filter((value, index) => moved(value) && !moved(delta[index])).length : 0);

/** Of the entries that fit, the one that fits most closely, whatever order the moves came in. */
function closest(pool: Vouch[], taken: Set<Vouch>, item: Item, key: string, delta: Sides | null): Vouch | undefined {
  const fitting = pool.filter((candidate) => !taken.has(candidate) && fits(candidate, item.kind, key, delta));
  return fitting.sort((a, b) => extraSides(a, delta) - extraSides(b, delta))[0];
}

/**
 * Whether every element or text this problem names is vouched for there;
 * uses the entries only when all are. Within one problem an entry vouches for
 * one element: two cards moving 80px and 20px here are not one card moving
 * 100px there.
 */
function vouchedFor(pool: Vouch[], item: Item): boolean {
  const undo: (() => void)[] = [];
  const taken = new Set<Vouch>();
  for (const [index, key] of item.keys.entries()) {
    const delta = item.deltas?.[index] ? sides(item.deltas[index]) : null;
    const entry = closest(pool, taken, item, key, delta);
    if (!entry) {
      for (const giveBack of undo) giveBack();
      return false;
    }
    taken.add(entry);
    undo.push(take(entry, delta));
  }
  return true;
}

/**
 * Which of this branch's problems the comparison site has too. A problem is
 * known when the site shows every element it moves, moving the same way by
 * about as much, or every text and error it names. The site's frames group
 * differently (a 5px nudge alone here can land inside a bigger jump there), so
 * elements are matched one by one across the phase. Each element movement or
 * text there vouches for one here: repeated cards share a key, and two of them
 * moving here is not one of them moving there.
 */
export function matchKnown(local: Item[], base: Item[]): boolean[] {
  const pool = vouchers(base);
  return local.map((item) => vouchedFor(pool, item));
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
