// Runs inside the page from its first script. Records, once per animation
// frame, what changed: layout boxes (offsets, so transforms never count),
// elements added or removed, and lines of visible text. Must stay one plain
// function with no outside references: Playwright sends it as source.
//
// OpenScholar and the Evidence Library run the same file; keep them in step.

export function recorder(config: { allow: string }) {
  const ids = new WeakMap<Element, number>();
  const nodes = new Map<number, HTMLElement>();
  const last = new Map<number, number[]>();
  const shown = new Map<number, boolean>();
  const lines = new Map<string, number>();
  let nextId = 1;
  let mutated = true;
  let allowed = new Set<Element>();
  const state = { frames: [] as unknown[], lastChange: 0, baseline: null as number | null };

  const attribute = (element: Element, names: string[]) => names.map((name) => element.getAttribute(name)).find((value) => value !== null) ?? "";
  const label = (element: Element) => attribute(element, ["aria-label", "data-testid", "data-slot", "role"]);
  const classes = (element: Element, count: number) => attribute(element, ["class"]).split(/\s+/).filter(Boolean).slice(0, count);
  const tagAndId = (element: Element) => element.tagName.toLowerCase() + (element.id ? `#${element.id}` : "");

  function trail(element: HTMLElement): string[] {
    const parents: string[] = [];
    for (let node = element.parentElement; node && node !== document.body && parents.length < 2; node = node.parentElement) parents.unshift(tagAndId(node));
    return parents;
  }

  const suffix = (value: string, before: string, after: string) => (value ? `${before}${value}${after}` : "");

  function describe(element: HTMLElement): string {
    const self = tagAndId(element) + suffix(classes(element, 4).join("."), ".", "");
    const text = (element.innerText || "").trim().replace(/\s+/g, " ").slice(0, 50);
    return `${[...trail(element), self].join(" > ")}${suffix(label(element), " [", "]")}${suffix(text, ' "', '"')}`;
  }

  (window as unknown as { __verify: unknown }).__verify = {
    take: () => {
      const frames = state.frames;
      state.frames = [];
      return { frames, baseline: state.baseline };
    },
    times: () => [state.lastChange, performance.now()],
    // What identifies an element across two sites: tag, classes and label,
    // never its text or position, which differ with data and timing.
    key: (id: number) => {
      const element = nodes.get(id);
      return element ? `${element.tagName.toLowerCase()}.${classes(element, 4).join(".")}[${label(element)}]` : `element ${id}`;
    },
    describe: (id: number) => {
      const element = nodes.get(id);
      return element ? describe(element) : `element ${id}`;
    },
  };
  new MutationObserver(() => {
    mutated = true;
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });

  // Recording counts from the parsed document with every font it declares
  // loaded. A weight first used when data arrives would otherwise swap in
  // later, at a different moment on each site.
  document.addEventListener("DOMContentLoaded", () => {
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
  const hasBorder = (style: CSSStyleDeclaration) =>
    ["top", "right", "bottom", "left"].some((side) => Number.parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0 && style.getPropertyValue(`border-${side}-style`) !== "none");
  // A wrapper that only grows around new content shows nothing; a card,
  // field or panel that draws a box shows its edge moving.
  const drawsBox = (element: HTMLElement) => {
    const style = getComputedStyle(element);
    return !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(style.backgroundColor) || style.backgroundImage !== "none" || style.boxShadow !== "none" || hasBorder(style);
  };
  // A switch's thumb sliding over is its own transition of its margin, by
  // design; whatever it pushes still counts, because that element isn't
  // animating. A fade or slide moves no layout box, so it exempts nothing.
  const LAYOUT = /^(margin|padding|width|height|top|left|right|bottom|inset|min|max|flex|grid|gap)/i;
  const animatedProperties = (animation: Animation) =>
    "transitionProperty" in animation ? [String(animation.transitionProperty)] : (animation.effect as KeyframeEffect | null)?.getKeyframes().flatMap((frame) => Object.keys(frame)) ?? [];
  const movesLayout = (animation: Animation) => animation.playState === "running" && animatedProperties(animation).some((property) => LAYOUT.test(property));
  const animating = (element: HTMLElement) => element.getAnimations().some(movesLayout);

  function idFor(element: HTMLElement): number {
    let id = ids.get(element);
    if (!id) {
      id = nextId++;
      ids.set(element, id);
      nodes.set(id, element);
    }
    return id;
  }

  type Frame = {
    moved: { id: number; dx: number; dy: number; dw: number; dh: number; within?: number }[];
    added: { id: number; box: number[]; within?: number; entering?: boolean }[];
    opened: number[];
    fresh: Set<Element>;
    removed: { id: number; box: number[] }[];
    textAdded: string[];
    textRemoved: string[];
    deltas: Map<number, number[]>;
    positions: Map<Element, number[]>;
  };

  function position(frame: Frame, element: Element | null): number[] {
    if (!(element instanceof HTMLElement)) return [0, 0];
    let at = frame.positions.get(element);
    if (!at) {
      // offsetLeft counts from inside the offset parent's border. Leaving the border out would move
      // everything in a bordered card by its width when the card stops being the offset parent, as
      // one does when its opening transform ends.
      const parent = position(frame, element.offsetParent);
      at = [parent[0] + (element.offsetParent?.clientLeft ?? 0) + element.offsetLeft, parent[1] + (element.offsetParent?.clientTop ?? 0) + element.offsetTop];
      frame.positions.set(element, at);
    }
    return at;
  }

  const tracked = (element: Element) => ids.has(element) && last.has(ids.get(element)!);

  /**
   * The nearest ancestor measured before this frame, whose movement a child may
   * share. One first measured now, a wrapper that has just opened, has no
   * movement of its own yet, so the child shares the next one's.
   */
  function trackedParent(frame: Frame, element: HTMLElement): Element | null {
    let parent = element.parentElement;
    while (parent && (!tracked(parent) || frame.fresh.has(parent))) parent = parent.parentElement;
    return parent;
  }

  // The smaller of how far something moved on screen and how far within its parent.
  const least = (onScreen: number, inParent: number) => (Math.abs(inParent) < Math.abs(onScreen) ? inParent : onScreen);

  /**
   * How an element moved by itself this frame. A child carried along by a
   * moving parent hasn't moved at all, and one that moved with its parent and
   * also grew has only grown, whichever frames the two changes land in. One
   * that holds still on screen while its parent's edge moves away, a row under
   * the part of a card that grows upward, hasn't moved either.
   */
  function ownDelta(frame: Frame, element: HTMLElement, delta: number[]): number[] {
    const parent = trackedParent(frame, element);
    const moved = parent && frame.deltas.get(ids.get(parent)!);
    return moved ? [least(delta[0], delta[0] - moved[0]), least(delta[1], delta[1] - moved[1]), delta[2], delta[3]] : delta;
  }

  const still = (delta: number[]) => delta.every((value) => Math.abs(value) < 1);
  // An element that draws no box shows nothing when it resizes, only when it
  // moves: a wrapper growing around new content is seen through the content
  // and the elements it pushes, whichever frame the resize lands in.
  const visible = (element: HTMLElement, own: number[]) => (drawsBox(element) ? own : [own[0], own[1], 0, 0]);

  /** Whether the element was or is on screen, updating what was shown. */
  function seenNow(element: HTMLElement, id: number): boolean {
    const was = shown.get(id) === true;
    shown.set(id, onScreen(element));
    return was || shown.get(id) === true;
  }

  // A dialog, sheet, popover or menu: what opens over the page.
  const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"]';

  /** The overlay an element is, or is inside. */
  function overlayOf(element: HTMLElement): { within?: number } {
    const overlay = element.closest(OVERLAY);
    return overlay && ids.has(overlay) ? { within: ids.get(overlay) } : {};
  }

  function measureMoved(frame: Frame, element: HTMLElement, id: number, delta: number[]) {
    frame.deltas.set(id, delta);
    const own = visible(element, ownDelta(frame, element, delta));
    if (seenNow(element, id) && !still(own) && !animating(element)) frame.moved.push({ id, dx: own[0], dy: own[1], dw: own[2], dh: own[3], ...overlayOf(element) });
  }
  // A frame that cuts off what is outside it; with `scrollers`, a scrolling list too.
  const clips = (element: Element, scrollers: boolean) => (scrollers ? /hidden|clip|auto|scroll/ : /hidden|clip/).test(getComputedStyle(element).overflowY);

  /** How much of a new element shows inside the ancestors that clip it, as a share of its height. */
  function showing(element: HTMLElement, overlay: Element, scrollers: boolean): number {
    const rect = element.getBoundingClientRect();
    let top = rect.top;
    let bottom = rect.bottom;
    for (let parent = element.parentElement; parent && parent !== overlay.parentElement; parent = parent.parentElement) {
      if (!clips(parent, scrollers)) continue;
      const clip = parent.getBoundingClientRect();
      top = Math.max(top, clip.top);
      bottom = Math.min(bottom, clip.bottom);
    }
    return rect.height > 0 ? Math.max(0, bottom - top) / rect.height : 0;
  }

  const fades = (animation: Animation) => animation.playState === "running" && animatedProperties(animation).includes("opacity");

  /**
   * Fading in, by itself or with something it is inside: still clear, or with
   * its opacity on the move. A spinner turning or a colour changing is not a
   * fade, and neither is something that is always half clear. The overlay's
   * own opening doesn't count: what lands while it opens still pops.
   */
  function fading(element: HTMLElement, overlay: Element): boolean {
    for (let node: HTMLElement | null = element; node && node !== overlay; node = node.parentElement) {
      if (Number(getComputedStyle(node).opacity) === 0 || node.getAnimations().some(fades)) return true;
    }
    return false;
  }

  // Not a pop: fading in, being uncovered by a frame that grows around it, or scrolled out of sight.
  const entering = (element: HTMLElement, overlay: Element) => fading(element, overlay) || showing(element, overlay, false) < 0.5 || showing(element, overlay, true) === 0;

  /**
   * For what opens over the page: the overlay a new element arrives in. Only
   * the outermost element of what arrives says so, and whether it is entering,
   * so a list that arrives is one arrival and not one per row. What comes with
   * the overlay says nothing.
   */
  function arrival(frame: Frame, element: HTMLElement): { within?: number; entering?: boolean } {
    const overlay = element.closest(OVERLAY);
    if (!overlay || overlay === element || !ids.has(overlay)) return {};
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (frame.fresh.has(parent)) return {};
      if (parent === overlay) break;
    }
    return { within: ids.get(overlay), entering: entering(element, overlay) };
  }

  function measure(frame: Frame, element: HTMLElement, seen: Set<number>) {
    const id = idFor(element);
    seen.add(id);
    const [x, y] = position(frame, element);
    const box = [x, y, element.offsetWidth, element.offsetHeight];
    const previous = last.get(id);
    last.set(id, box);
    if (!previous) {
      shown.set(id, onScreen(element));
      if (shown.get(id)) frame.added.push({ id, box, ...arrival(frame, element) });
      // A sheet starts off screen and slides in, so an overlay opening is noted wherever it is.
      if (element.matches(OVERLAY)) frame.opened.push(id);
      frame.fresh.add(element);
      return;
    }
    const delta = box.map((value, index) => value - previous[index]);
    if (delta.some((value) => Math.abs(value) >= 1)) measureMoved(frame, element, id, delta);
  }

  function forget(frame: Frame, seen: Set<number>) {
    for (const [id, box] of last) {
      if (seen.has(id)) continue;
      last.delete(id);
      if (shown.get(id)) frame.removed.push({ id, box });
      shown.delete(id);
    }
  }

  function countLines(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const text of document.body.innerText.split("\n").map((line) => line.trim()).filter(Boolean)) counts.set(text, (counts.get(text) || 0) + 1);
    return counts;
  }

  /** Each line `to` holds more times than `from`, once per extra time. */
  function extra(from: Map<string, number>, to: Map<string, number>): string[] {
    return [...to].flatMap(([text, count]) => Array.from({ length: Math.max(0, count - (from.get(text) || 0)) }, () => text));
  }

  function readText(frame: Frame) {
    const now = countLines();
    frame.textAdded.push(...extra(lines, now));
    frame.textRemoved.push(...extra(now, lines));
    lines.clear();
    for (const [text, count] of now) lines.set(text, count);
  }

  const measurable = (element: Element): element is HTMLElement => element instanceof HTMLElement && !allowed.has(element) && element.offsetWidth > 0 && element.offsetHeight > 0;

  function measureAll(frame: Frame) {
    const seen = new Set<number>();
    for (const element of document.body.getElementsByTagName("*")) if (measurable(element)) measure(frame, element, seen);
    forget(frame, seen);
  }

  function record(frame: Frame) {
    if (!mutated) return measureAll(frame);
    allowed = new Set(document.querySelectorAll(config.allow));
    measureAll(frame);
    readText(frame);
    mutated = false;
  }

  function tick() {
    const t = performance.now();
    const frame: Frame = { moved: [], added: [], opened: [], fresh: new Set(), removed: [], textAdded: [], textRemoved: [], deltas: new Map(), positions: new Map() };
    if (document.body) record(frame);
    const { moved, added, opened, removed, textAdded, textRemoved } = frame;
    if ([moved, added, opened, removed, textAdded, textRemoved].some((list) => list.length > 0)) {
      state.frames.push({ t, moved, added, opened, removed, textAdded, textRemoved });
      state.lastChange = t;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
