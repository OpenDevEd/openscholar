// What `npm run verify` decides from what a browser recorded. The recorder
// sends one Frame per animation frame in which something changed: elements
// whose layout box moved or resized (transforms excluded, so a fade or slide
// is never a shift), elements added or removed, and lines of visible text
// added or removed.
//
// OpenScholar and the Evidence Library run the same file (scripts/verify in
// OpenDevEd/openalex-count, tools/verify in OpenDevEd/new-el); keep them in step.

export type Delta = { dx: number; dy: number; dw: number; dh: number };
// `inside` is the dialog, sheet, popover or menu an element is, or is in.
export type Move = Delta & { id: number; inside?: number };

// A layout box: x, y, width, height.
export type Box = [number, number, number, number];

export type Frame = {
  t: number;
  moved: Move[];
  // `within` is the dialog, sheet, popover or menu an element arrived in after
  // it opened, given to the outermost element of what arrived, with whether
  // that is fading or sliding in.
  added: { id: number; box: Box; inside?: number; within?: number; entering?: boolean }[];
  // The dialogs, sheets, popovers and menus that opened in this frame.
  opened?: number[];
  removed: { id: number; box: Box; inside?: number }[];
  textAdded: string[];
  textRemoved: string[];
  // The same lines, counted only in what the open dialogs, sheets, popovers and menus show.
  overlayTextAdded?: string[];
  overlayTextRemoved?: string[];
  // Pictures that went from not showing (unloaded, or hidden by their own
  // opacity or a parent's) to fully showing in this one frame, with when they
  // were last seen not showing while on screen.
  pictures?: { id: number; hiddenSince: number; inside?: number }[];
};

// A load phase starts with navigation; everything after `baseline` (fonts
// ready, document parsed) must hold still. A step phase starts with an action;
// its first burst of change is the response to the action. An early phase is
// an action taken while the page is still loading: only what happens in the
// dialog, sheet, popover or menu it opens is judged.
export type Phase = { name: string; kind: "load" | "step" | "early"; start: number; baseline?: number };

export type Finding =
  | { kind: "shift"; from: number; to: number; moves: Move[] }
  | { kind: "text-flash"; text: string; from: number; to: number }
  | { kind: "brief-text"; text: string; from: number; to: number }
  | { kind: "brief-element"; id: number; from: number; to: number }
  | { kind: "late-content"; id: number; from: number; to: number }
  | { kind: "picture-pop"; id: number; from: number; to: number };

// Frames closer than this belong to one burst, such as one animated resize.
const BURST_GAP_MS = 120;
// Text that comes back within this long flashed instead of changing.
const FLASH_RETURN_MS = 2_000;
// Text or an element shown for less than this was a blink, not a state.
const BRIEF_MS = 400;
// Elements smaller than this (a 20×20 icon) are too small to read as a flash.
const MIN_FLASH_AREA = 400;

// The first moments after a dialog appears belong to its opening.
const OPENING_MS = 150;
// A picture that shows within this long of its place appearing loaded in time; one that took longer was waited for.
const PICTURE_WAIT_MS = 150;

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

// An element that moves a little in each of several frames in a row is being
// animated: a frame sliding open, and whatever it pushes along. One that covers
// its distance in a frame or two jumped.
const SLIDE_FRAMES = 5;
// A busy browser drops a few frames in the middle of a slide.
const SLIDE_GAP_MS = 80;
// One step of a slide is never far from the step beside it; the slack covers the uneven frames it starts with.
const SLIDE_STEP_RATIO = 3;
const SLIDE_STEP_SLACK_PX = 8;
// No one step of a slide covers much of the distance by itself.
const SLIDE_STEP_SHARE = 1 / 3;
// The slow end of a slide moves a pixel every few frames.
const SLIDE_TAIL_PX = 2;
// A part a slide passes is nudged a pixel at a time by rounding, a few times at most.
const SLIDE_NUDGES_PX = 4;
const SIDES = ["dx", "dy", "dw", "dh"] as const;

// `counted` is false for movement that belongs to an overlay's own opening: it still says whether the element slid.
type Step = { t: number; move: Move; changed: boolean; counted: boolean };
const near = (size: number, other: number) => size <= SLIDE_STEP_RATIO * other + SLIDE_STEP_SLACK_PX;

/**
 * Whether one side's steps, each the time of its frame and how far it went,
 * are one smooth slide: enough frames in a row, going one way, each step near
 * the one beside it and none covering much of the distance. It may start on a
 * short step, since a slide rarely begins on a frame.
 */
function smooth(steps: [number, number][]): boolean {
  if (steps.length < SLIDE_FRAMES) return false;
  const total = steps.reduce((sum, [, size]) => sum + Math.abs(size), 0);
  // ponytail: a spring that overshoots and comes back reads as a shift; allow one decaying turn if a slide ever bounces.
  const way = Math.sign(steps[0][1]);
  return steps.every(([t, signed], index) => {
    const size = Math.abs(signed);
    if (Math.sign(signed) !== way || size > total * SLIDE_STEP_SHARE + SLIDE_TAIL_PX) return false;
    if (index === 0) return true;
    const [before, lastSigned] = steps[index - 1];
    const last = Math.abs(lastSigned);
    const unbroken = t - before <= SLIDE_GAP_MS || Math.max(size, last) <= SLIDE_TAIL_PX;
    return unbroken && near(last, size) && (index === 1 || near(size, last));
  });
}

/** How far a side went in all, whichever way. */
const travelled = (steps: Step[], side: (typeof SIDES)[number]) => steps.reduce((sum, step) => sum + Math.abs(step.move[side]), 0);

/**
 * Whether an element slid: every side of its box that moved did so smoothly,
 * bar a pixel or two of rounding on another side. Each side is judged by
 * itself, so a frame growing smoothly can't hide a jump sideways. Being pushed
 * along by rows that keep arriving or leaving is not a slide: a slide's
 * content changes as it starts, and most of its frames add and remove nothing.
 */
function slid(steps: Step[]): boolean {
  if (steps.filter((step) => step.changed).length * 2 > steps.length) return false;
  const sides = SIDES.filter((side) => travelled(steps, side) > SLIDE_TAIL_PX);
  return sides.length > 0 && sides.every((side) => smooth(steps.filter((step) => Math.abs(step.move[side]) >= 1).map((step): [number, number] => [step.t, step.move[side]])));
}

/** The furthest each side got from where it started. A jump out and back ends where it began, and is still that jump. */
function furthest(id: number, steps: Step[]): Move {
  const at: Delta = { dx: 0, dy: 0, dw: 0, dh: 0 };
  const peak: Move = { id, dx: 0, dy: 0, dw: 0, dh: 0 };
  for (const { move } of steps) {
    for (const side of SIDES) {
      at[side] += move[side];
      if (Math.abs(at[side]) > Math.abs(peak[side])) peak[side] = at[side];
    }
  }
  return peak;
}

function shift(frames: Frame[], counted: (frame: Frame, move: Move) => boolean = () => true): Finding | null {
  const steps = new Map<number, Step[]>();
  for (const frame of frames) for (const move of frame.moved) steps.set(move.id, [...(steps.get(move.id) ?? []), { t: frame.t, move, changed: frame.added.length + frame.removed.length > 0, counted: counted(frame, move) }]);
  // A slide leaves rounding on the parts it carries along: a pixel or two at once, or a pixel at a time a few times.
  const beside = [...steps.values()].some(slid);
  const rounding = (own: Step[]) => SIDES.every((side) => travelled(own, side) <= SLIDE_TAIL_PX || (travelled(own, side) <= SLIDE_NUDGES_PX && own.every((step) => Math.abs(step.move[side]) <= 1)));
  const jumped = [...steps]
    .filter(([, own]) => !slid(own) && !(beside && rounding(own)))
    .map(([id, own]): [number, Step[]] => [id, own.filter((step) => step.counted)])
    .filter(([, own]) => own.length > 0);
  if (jumped.length === 0) return null;
  const times = jumped.flatMap(([, own]) => own.map((step) => step.t));
  return { kind: "shift", from: Math.min(...times), to: Math.max(...times), moves: jumped.map(([id, own]) => furthest(id, own)) };
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

// A line with its numbers blanked.
const words = (text: string) => text.replace(/\d+(?:[.,]\d+)*/g, "0");

/**
 * A frame's text changes with the lines that only changed their numbers
 * paired off, one removed line to one added line. A number counting up or
 * down changes its line every frame: the same words with new numbers is one
 * line changing its value, not text blinking.
 */
function counted(frame: Frame): { pairs: [string, string][]; removed: string[]; added: string[] } {
  const added = [...frame.textAdded];
  const pairs: [string, string][] = [];
  const removed = frame.textRemoved.filter((text) => {
    const at = added.findIndex((other) => words(other) === words(text));
    if (at >= 0) pairs.push([text, added.splice(at, 1)[0]]);
    return at < 0;
  });
  return { pairs, removed, added };
}

// How often a line has changed its value so far, by the text it shows now.
// A line that changes once may be a stale value corrected ("0 papers", then
// "126 papers"), which is a blink of the stale one; a line that changes again
// is counting.
type Changes = Map<string, { times: number; stale: Finding | null }>;

/** A line that changed its value has been on screen since the old value appeared. */
function carry(history: TextHistory, changes: Changes, [from, to]: [string, string], t: number, since: number) {
  const shown = history.shownAt.get(from)?.pop();
  if (shown !== undefined) history.shownAt.set(to, [...(history.shownAt.get(to) ?? []), shown]);
  const before = changes.get(from);
  changes.delete(from);
  const brief = shown !== undefined && shown >= since && t - shown < BRIEF_MS;
  changes.set(to, { times: (before?.times ?? 0) + 1, stale: !before && brief ? { kind: "brief-text", text: from, from: shown, to: t } : null });
}

function textBlinks(frames: Frame[], since: number): Finding[] {
  const history: TextHistory = { shownAt: new Map(), goneAt: new Map() };
  const changes: Changes = new Map();
  const seen = frames.flatMap((frame) => {
    const { pairs, removed, added } = counted(frame);
    for (const pair of pairs) carry(history, changes, pair, frame.t, since);
    // A line that leaves is judged by how long it was there, whatever it showed.
    for (const text of removed) changes.delete(text);
    return [...removed.flatMap((text) => textGone(history, text, frame.t, since)), ...added.flatMap((text) => textShown(history, text, frame.t))];
  });
  const findings = [...seen, ...[...changes.values()].flatMap((change) => (change.stale ? [change.stale] : []))];
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

/**
 * Content that shows up inside a dialog, sheet, popover or menu after it has
 * opened, without fading or sliding in: it read its data only once it was
 * open, and the data popped in. One finding per overlay and frame, for the
 * largest thing that arrived.
 */
function arrivals(frames: Frame[]): Finding[] {
  const opened = new Map<number, number>();
  const findings: Finding[] = [];
  const area = (box: Box) => box[2] * box[3];
  for (const frame of frames) {
    for (const id of frame.opened ?? []) opened.set(id, frame.t);
    for (const { id } of frame.removed) opened.delete(id);
    const popped = frame.added.filter((element) => !element.entering && area(element.box) >= MIN_FLASH_AREA && frame.t - (opened.get(element.within ?? -1) ?? Infinity) > OPENING_MS);
    for (const overlay of new Set(popped.map((element) => element.within!))) {
      const largest = popped.filter((element) => element.within === overlay).sort((a, b) => area(b.box) - area(a.box))[0];
      findings.push({ kind: "late-content", id: largest.id, from: opened.get(overlay)!, to: frame.t });
    }
  }
  return findings;
}

/** A picture someone saw missing, then all at once, instead of fading in. */
function picturePops(frames: Frame[], since: number): Finding[] {
  return frames.flatMap((frame) =>
    (frame.pictures ?? [])
      .filter((picture) => frame.t >= since && frame.t - picture.hiddenSince >= PICTURE_WAIT_MS)
      .map((picture): Finding => ({ kind: "picture-pop", id: picture.id, from: picture.hiddenSince, to: frame.t })),
  );
}

/**
 * An overlay opened while the page loads: what moved in it after it opened,
 * what blinked in it, and what popped into it. The page behind is still
 * loading, which a load phase judges, so only what is inside a dialog, sheet,
 * popover or menu is looked at. What moves as it opens is its opening, but
 * still says whether what follows is one slide.
 */
function analyzeEarly(frames: Frame[], since: number): Finding[] {
  const opened = new Map<number, number>();
  for (const frame of frames) for (const id of frame.opened ?? []) opened.set(id, frame.t);
  const inside = (entry: { inside?: number }) => opened.has(entry.inside ?? -1);
  const overlays = frames.map((frame): Frame => ({ ...frame, moved: frame.moved.filter(inside), added: frame.added.filter(inside), removed: frame.removed.filter(inside), textAdded: frame.overlayTextAdded ?? [], textRemoved: frame.overlayTextRemoved ?? [], pictures: frame.pictures?.filter(inside) }));
  const late = (frame: Frame, move: Move) => frame.t - opened.get(move.inside!)! > OPENING_MS;
  const shifts = bursts(overlays.filter(changed)).map((burst) => shift(burst, late)).filter((finding): finding is Finding => finding !== null);
  return [...shifts, ...textBlinks(overlays, since), ...elementBlinks(overlays, since), ...arrivals(frames), ...picturePops(overlays, since)].sort((a, b) => a.from - b.from || a.kind.localeCompare(b.kind));
}

/** The problems a person would see in one phase: movement after the page or the response settled, and blinks. */
export function analyzePhase(frames: Frame[], phase: Phase): Finding[] {
  if (phase.kind === "early") return analyzeEarly(frames.filter((frame) => frame.t >= phase.start), phase.start);
  const since = phase.kind === "load" ? (phase.baseline ?? phase.start) : phase.start;
  const groups = bursts(frames.filter((frame) => frame.t >= since && changed(frame)));
  // After an action, the first burst is the response (a dialog opening, a row
  // growing as it animates). Anything that moves after it moved on its own.
  const late = phase.kind === "step" ? groups.slice(1) : groups;
  const shifts = late.map((burst) => shift(burst)).filter((finding): finding is Finding => finding !== null);
  // Only what an action opened is judged for late content: a page still loading fills in by design.
  const popped = phase.kind === "step" ? arrivals(frames.filter((frame) => frame.t >= since)) : [];
  return [...shifts, ...textBlinks(frames, since), ...elementBlinks(frames, since), ...popped, ...picturePops(frames, since)].sort((a, b) => a.from - b.from || a.kind.localeCompare(b.kind));
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
  /** How many dialogs, sheets, popovers or menus the last passing check opened. Absent for a recorded skip. */
  lastPassOpened?: number;
  changed: { path: string; mtimeMs: number; overlay?: boolean }[];
  userFacing: RegExp;
}): { block: false } | { block: true; files: string[]; unopened?: true } {
  if (input.stopHookActive) return { block: false };
  const since = Math.max(input.sessionStartMs, input.lastPassMs ?? 0);
  const seen = input.changed.filter((file) => input.userFacing.test(file.path));
  const files = seen.filter((file) => file.mtimeMs > since).map((file) => file.path);
  if (files.length > 0) return { block: true, files };
  // A check that opened nothing says nothing about a dialog this session changed.
  const overlays = seen.filter((file) => file.overlay && file.mtimeMs > input.sessionStartMs).map((file) => file.path);
  return overlays.length > 0 && input.lastPassOpened === 0 ? { block: true, files: overlays, unopened: true } : { block: false };
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
