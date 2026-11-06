"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { preload } from "react-dom";
import { useSearchParams } from "next/navigation";
import { parseSearchParamsFromUrl, readUrlQuestion } from "@/lib/search-params";
import { highlightSegments, queryMatcher } from "@/lib/search/boolean-query";
import { useQuestionStage } from "@/lib/search/question-stage";
import { EARTH_SCRIPT } from "@/lib/search/question-stage-script";
import { earthLayout, ringMarkup, spaceHeight, EARTH_IMAGES, EARTH_STILL, SKY_PLATE, STILL_REACH, type Earth, type EarthConfig } from "./question-stage-earth";
import styles from "./question-stage.module.css";

/** The query box's concepts, in the order it colours them, lightened for the night sky. */
const CONCEPT_COLOURS = ["#ff9d36", "#7cc7ff", "#b9a7ff", "#6fe0ae", "#ff9ccf", "#6fd9d2"];
const MAX_WORDS = 30;
/** However fast the answer, the question is on screen this long: it should read, not flash. */
const LEAST_MS = 1300;
/** The lit words hold this long before they leave. */
const LIT_MS = 900;
/** The page gets this long to finish loading its results behind the stage. */
const PAGE_MS = 8000;
/** How long the question takes to settle into the planet. The sun comes up as it arrives. */
const SETTLE_MS = 800;
/** From the sun's first light to the sky being full of it. */
const DAWN_MS = 1500;
/** How much later the farthest word sets off than the nearest. */
const WORD_STAGGER_MS = 160;
/** How much of the gap between them the planet covers, and its most in pixels. The words cover the rest. */
const RISE_SHARE = 0.5;
const RISE_MAX = 170;
/** The most the planet moves down after the hero has gone. It zooms for the rest. */
const SETTLE_DOWN_MAX = 120;
/** How small a word has got as it fades into the planet. */
const WORD_END = 0.4;
/**
 * The wave that reads across the question while the query is written: one pass every READ_MS, its front crossing the
 * question in READ_SPAN_MS, each word dim for a quarter of the pass. A word dims about twice in five seconds, far from a
 * flicker, and three or four are dim at once, so it travels and the question stays readable.
 */
const READ_MS = 2400;
const READ_SPAN_MS = 1600;
/** How long one underline takes to draw: the transition on `.word` in the stylesheet. */
const UNDERLINE_MS = 600;
/** The glints take turns, one slot each, a twinkle lasting half a slot. */
const GLINT_SLOTS = 8;
const GLINT_SLOT_S = 1.2;
/** Seconds into the wait before the status line counts them. */
const COUNT_AFTER_S = 8;

// The marketing hero's stars, from the same seed: fixed in size and place, and none behind its headline or box.
const STARS = (() => {
  let seed = 11;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  return Array.from({ length: 340 }, (_, i) => {
    const x = +(random() * 2560).toFixed(1);
    const y = +(random() * 820).toFixed(1);
    const big = i < 10;
    const small = random() < 0.85;
    const r = +(big ? 1.4 + random() * 0.4 : small ? 0.5 + random() * 0.4 : 0.9 + random() * 0.4).toFixed(2);
    const opacity = +((big ? 0.9 : small ? 0.2 + random() * 0.4 : 0.7) * Math.min(1, (820 - y) / 246)).toFixed(2);
    return { x, y, r, opacity, group: i % 3 };
  }).filter(({ x, y, opacity }) => opacity > 0 && (x < 720 || x > 1840 || y < 136 || y > 390));
})();

/**
 * Up to eight bright stars in open sky on this screen, clear of the question and the planet, which twinkle one at a time
 * where the whole sky's twinkle costs too much. One at a time, because two far apart make the browser redraw everything
 * between them on every frame: on a software renderer that took the page from 120 frames a second to 70.
 */
function pickGlints(frame: Frame, layout: ReturnType<typeof earthLayout>) {
  const left = frame.width / 2 - 1280;
  const top = frame.skyTop ?? 0;
  const head = frame.questionTop ?? 146;
  const planetTop = frame.spaceTop + layout.cy - layout.R;
  return STARS.filter((star) => star.opacity >= 0.6)
    .map((star) => ({ x: left + star.x, y: top + star.y }))
    .filter(({ x, y }) => x > 16 && x < frame.width - 16 && y > 32)
    .filter(({ x, y }) => y < planetTop - 40 || Math.abs(x - layout.cx) > layout.R * 1.4)
    .filter(({ x, y }) => Math.abs(x - frame.width / 2) > 600 || y < head - 20 || y > head + 200)
    .filter((spot, i, spots) => spots.slice(0, i).every((other) => Math.hypot(spot.x - other.x, spot.y - other.y) > 120))
    .slice(0, GLINT_SLOTS);
}

/**
 * Where things are on the screen: the page width, the sky's top, the planet's box, and the question's top. `level` is the
 * quality level the hero's planet had got to, as the app's address can't read what the marketing site remembered. `left` is
 * where the hero's full-width sky started: with a scrollbar that takes room, the sky reaches under it and starts half a
 * scrollbar off the left edge, so the hero's middle, and its planet and headline, sit left of the window's middle.
 */
type Frame = { width: number; skyTop?: number; spaceTop: number; spaceHeight: number; questionTop?: number; turn: EarthConfig["turn"]; level?: number; left?: number };

/** The hero's measurements, sent in the address so the first paint lands exactly on its last frame. */
function readHandover(value: string | null): Frame | null {
  const numbers = value?.split(",").map(Number) ?? [];
  if (numbers.length !== 9 || numbers.some((n) => !Number.isFinite(n))) return null;
  const [width, skyTop, spaceTop, height, questionTop, t, at, level, left] = numbers;
  if ([width, skyTop, spaceTop, height, questionTop].some((n) => Math.abs(n) > 10000) || Math.abs(left) > 100 || !Number.isInteger(level) || level < 0 || level > 5) return null;
  return width > 0 && height > 0 ? { width, skyTop, spaceTop, spaceHeight: height, questionTop, turn: { t, at }, level, left } : null;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/**
 * How much bigger the planet has to be, zooming from its top edge, for the foot of its box to stay below the screen. The
 * hero's links cover that foot, and without them the planet would look cut off.
 */
const zoomToClear = (top: number, foot: number) => Math.max(1, (innerHeight + 60 - top) / (foot - top));

/** One word's way into the planet: it sinks first and gathers towards the point late, so its path curves, and it fades as it arrives. */
function wordSettle(dx: number, dy: number) {
  return Array.from({ length: 41 }, (_, i) => {
    const t = i / 40;
    const u = smooth(t);
    const scale = 1 - (1 - WORD_END) * u;
    return { transform: `translate(${(dx * u ** 1.8).toFixed(2)}px, ${(dy * u ** 1.2).toFixed(2)}px) scale(${scale.toFixed(4)})`, opacity: clamp01((1 - t) / 0.45) };
  });
}

/** The question's words, each with the concept of the query it matched, if any. */
function questionWords(question: string, query: string | null) {
  const segments = highlightSegments(question, query ? queryMatcher(query) : null);
  const concepts: (number | undefined)[] = [];
  for (const segment of segments) for (const _ of segment.text) concepts.push(segment.concept);
  const words = [...question.matchAll(/\S+/g)].map((match) => ({
    text: match[0],
    concept: concepts.slice(match.index, match.index + match[0].length).find((c) => c !== undefined),
  }));
  return words.length > MAX_WORDS ? [...words.slice(0, MAX_WORDS), { text: "...", concept: undefined }] : words;
}

/**
 * In front of the results page while AI writes the query for a question in the address: the
 * marketing hero's Earth and sky go on, with the question as the headline. When the query is
 * written the words it uses light up, and once the page behind has its results the question settles
 * into the planet as it rises to meet it, and the sun comes up from behind it where they touch.
 */
export function QuestionStage() {
  const params = useSearchParams();
  const [question] = useState(() => (parseSearchParamsFromUrl(params).q?.trim() ? "" : readUrlQuestion(params)));
  const [handover] = useState(() => readHandover(params.get("hero")));
  const [frame, setFrame] = useState<Frame | null>(handover);
  const [lit, setLit] = useState(false);
  const [flying, setFlying] = useState(false);
  const [done, setDone] = useState(false);
  const query = useQuestionStage((state) => state.query);
  const stage = useRef<HTMLDivElement>(null);
  const space = useRef<HTMLDivElement>(null);
  const plate = useRef<HTMLImageElement>(null);
  const headline = useRef<HTMLHeadingElement>(null);
  const sun = useRef<HTMLDivElement>(null);
  const dawn = useRef<HTMLDivElement>(null);
  const wash = useRef<HTMLDivElement>(null);
  const stars = useRef<SVGSVGElement[]>([]);
  const glints = useRef<HTMLDivElement>(null);
  const words = useMemo(() => questionWords(question, lit ? query : null), [question, lit, query]);
  const layout = useMemo(() => (frame ? earthLayout(frame.width) : null), [frame]);
  const glintSpots = useMemo(() => (frame && layout ? pickGlints(frame, layout) : []), [frame, layout]);
  const rings = useMemo(() => (layout ? { back: ringMarkup(layout, false), front: ringMarkup(layout, true) } : null), [layout]);

  if (question) {
    preload(SKY_PLATE, { as: "image", fetchPriority: "high" });
    // The maps are fetched early only for a level known to be live: the hero's. Otherwise earth.js fetches
    // them once it has chosen a level, so a visitor saving data, who gets the still, never downloads them. The light
    // levels use the smaller day map.
    const known = handover?.level;
    if (!handover || known === 0) preload(EARTH_STILL, { as: "image", fetchPriority: "high" });
    if (known) for (const src of EARTH_IMAGES) preload(known <= 2 ? src.replace("earth-day.", "earth-day-2048.") : src, { as: "image", fetchPriority: "high" });
  }

  // WebGL, the frame clock and the page behind are all outside React: this reads the page's field
  // from the DOM and moves the question's words by hand, so nothing here re-renders while it flies.
  useEffect(() => {
    if (!question) return;
    // Nobody measured the screen for a visitor who came straight here, so it's done now and the planet fades in.
    if (!frame) {
      const height = spaceHeight(innerWidth);
      setFrame({ width: innerWidth, spaceTop: Math.max(innerWidth < 700 ? 230 : 200, innerHeight - height - 70), spaceHeight: height, turn: null });
      return;
    }
    const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
    stage.current!.dataset.moving = "";
    const planetEl = space.current!;
    const planetTop = frame.spaceTop + layout!.cy - layout!.R;
    const planetFoot = frame.spaceTop + frame.spaceHeight;
    // Always from the planet's top edge, so it stays where the question will land.
    planetEl.style.transformOrigin = `${layout!.cx}px ${layout!.cy - layout!.R}px`;
    // It settles down into the room the hero's links left, and zooms for whatever that doesn't cover.
    const down = Math.min(Math.max(0, innerHeight - planetFoot), SETTLE_DOWN_MAX);
    const settled = `translateY(${down}px) scale(${zoomToClear(planetTop + down, planetFoot + down)})`;
    if (calm) planetEl.style.transform = settled;
    else planetEl.animate([{ transform: "none" }, { transform: settled }], { duration: 1800, delay: 100, easing: "cubic-bezier(.45,0,.2,1)", fill: "both" });
    const stillImage = stage.current!.querySelector<HTMLImageElement>("[data-still] img");
    for (const image of [plate.current!, stillImage]) void image?.decode().then(() => (image.dataset.in = ""), () => {});
    // Coming through the hero the planet is already going: marketing/src/planet/earth.js started it as the stage arrived.
    // If it isn't going in this stage (a visitor who came straight here, or a stage React has built afresh), it starts now.
    const stageEl = stage.current!;
    let earth: Earth | undefined;
    const begin = () => (earth = window.questionStageEarth!.boot(stageEl));
    if (window.questionStageEarth) begin();
    else {
      const loading = document.querySelector<HTMLScriptElement>(`script[src="${EARTH_SCRIPT}"]`);
      if (loading) loading.addEventListener("load", begin);
      else {
        const script = document.createElement("script");
        script.src = EARTH_SCRIPT;
        script.onload = begin;
        document.head.append(script);
      }
    }
    // While the query is written a slow wave of light reads across the question, where the eye already is, at every quality
    // level. When the query arrives it finishes the pass it's on, and the underlines follow it across.
    const spans = [...headline.current!.children] as HTMLElement[];
    const step = READ_SPAN_MS / spans.length;
    // The underlines cross faster than the wave when the question is long, so the last is drawn before the question leaves.
    headline.current!.style.setProperty("--step", `${Math.min(step, (LIT_MS - UNDERLINE_MS) / spans.length)}ms`);
    const read = [{ opacity: 1, easing: "ease-in-out" }, { opacity: 0.55, offset: 0.12, easing: "ease-in-out" }, { opacity: 1, offset: 0.25 }, { opacity: 1 }];
    // Coming straight here the words rise in first.
    const readFrom = handover ? 0 : 750 + spans.length * 45;
    const reading = calm ? [] : spans.map((span, i) => span.animate(read, { duration: READ_MS, delay: readFrom + i * step, iterations: Infinity }));
    const started = performance.now();
    let litAt = 0;
    let raf = 0;
    let finish = 0;
    // The component stays mounted once it's done, so the planet has to be stopped here.
    const end = () => {
      cancelAnimationFrame(raf);
      earth?.stop();
      setDone(true);
    };

    // The question settles into the planet as the planet rises to meet it, the planet turns into its own shadow,
    // and the sun comes up from behind it where they touched, until the sky is full of light and the page is there.
    const land = () => {
      setFlying(true);
      const root = stage.current!;

      if (calm || !layout) {
        delete document.documentElement.dataset.questionStage;
        root.style.transition = "opacity .3s";
        root.style.opacity = "0";
        finish = window.setTimeout(end, 320);
        return;
      }

      const planet = planetEl;
      // Carries on from wherever it has got to.
      const from = getComputedStyle(planet).transform;
      const now = new DOMMatrix(from);
      for (const motion of planet.getAnimations()) motion.cancel();
      planet.style.transform = from;
      const spans = [...headline.current!.children] as HTMLElement[];
      const question = headline.current!.getBoundingClientRect();
      const top = planetTop + now.m42;
      const rise = Math.min(Math.max(0, top - question.bottom) * RISE_SHARE, RISE_MAX);
      const met = now.m42 - rise;
      const zoom = zoomToClear(planetTop + met, planetFoot + met);
      const x = frame.width / 2;
      const y = planetTop + met + layout.R * zoom * 0.04;
      // The words are measured in the window, the planet in the sky, which may start a little left of the window.
      const wordsX = x + (frame.left ?? 0);

      const centres = spans.map((span) => span.getBoundingClientRect()).map((r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 }));
      const farthest = Math.max(1, ...centres.map((c) => Math.hypot(c.x - wordsX, c.y - y)));
      spans.forEach((span, i) => {
        span.style.transformOrigin = "50% 50%";
        const near = Math.hypot(centres[i].x - wordsX, centres[i].y - y) / farthest;
        span.animate(wordSettle(wordsX - centres[i].x, y - centres[i].y), { duration: SETTLE_MS - WORD_STAGGER_MS, delay: near * WORD_STAGGER_MS, fill: "both" });
      });

      earth?.sunBehind(SETTLE_MS + 200);
      const whole = SETTLE_MS + DAWN_MS;
      planet.animate(
        [
          { transform: from, easing: "cubic-bezier(.45,0,.35,1)", offset: 0 },
          { transform: `translateY(${met}px) scale(${zoom})`, easing: "cubic-bezier(.55,0,.35,1)", offset: SETTLE_MS / whole },
          { transform: `translateY(${met + layout.R * zoom}px) scale(${zoom})`, offset: 1 },
        ],
        { duration: whole, fill: "forwards" },
      );

      // The sun starts behind the planet's edge, so the planet uncovers it as it comes up.
      const sunrise = sun.current!;
      const light = { delay: SETTLE_MS * 0.7, fill: "forwards" as const };
      sunrise.animate(
        [
          { opacity: 0, transform: `translate(${x}px, ${y}px) translate(-50%, -50%) translateY(${layout.R * zoom * 0.3}px) scale(.45)` },
          { opacity: 1, offset: 0.2 },
          { opacity: 1, transform: `translate(${x}px, ${y}px) translate(-50%, -50%) translateY(${-layout.R * 0.28}px) scale(2.3)` },
        ],
        { ...light, duration: DAWN_MS, easing: "cubic-bezier(.25,.5,.25,1)" },
      );
      const sky = dawn.current!;
      sky.style.setProperty("--sun-x", `${x}px`);
      sky.style.setProperty("--sun-y", `${y}px`);
      sky.animate([{ opacity: 0 }, { opacity: 1 }], { ...light, duration: DAWN_MS * 0.8, easing: "cubic-bezier(.4,0,.5,1)" });
      for (const layer of [plate.current!, ...stars.current, glints.current!]) layer.animate({ opacity: 0 }, { delay: SETTLE_MS * 0.8, duration: DAWN_MS * 0.6, easing: "ease-in", fill: "forwards" });

      // The light becomes the page: cream over a light page, and over a dark one the sky simply fades into it.
      if (!document.documentElement.classList.contains("dark")) wash.current!.animate([{ opacity: 0 }, { opacity: 1 }], { delay: SETTLE_MS + DAWN_MS * 0.4, duration: DAWN_MS * 0.5, easing: "cubic-bezier(.5,0,.6,1)", fill: "forwards" });
      const leaveAt = SETTLE_MS + DAWN_MS * 0.85;
      finish = window.setTimeout(() => {
        delete document.documentElement.dataset.questionStage;
        root.animate({ opacity: 0 }, { duration: 550, easing: "ease-in-out", fill: "forwards" }).finished.then(end, end);
      }, leaveAt);
    };
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (!litAt) {
        if (useQuestionStage.getState().query !== null && now - started >= LEAST_MS - LIT_MS) {
          litAt = now;
          const pass = reading[0]?.effect?.getComputedTiming().currentIteration;
          for (const word of reading) word.effect?.updateTiming({ iterations: pass == null ? 0 : pass + 1 });
          // The pass speeds up to end before the question leaves, as a pace that quickens reads as nearing the end.
          const left = Math.max(0, ...reading.map((word) => Number(word.effect?.getComputedTiming().endTime ?? 0) - Number(word.currentTime ?? 0)));
          if (left > LIT_MS - 100) for (const word of reading) word.updatePlaybackRate(left / (LIT_MS - 100));
          setLit(true);
          earth?.wave();
        }
        return;
      }
      if (now - litAt < LIT_MS) return;
      const settled = document.querySelector<HTMLElement>("[data-question-field]")?.dataset.questionField === "settled";
      if (settled || now - litAt > PAGE_MS) {
        cancelAnimationFrame(raf);
        land();
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(finish);
      for (const word of reading) word.cancel();
    };
  }, [question, frame, layout, handover]);

  if (!question || done) return null;

  const size = question.length <= 40 ? "large" : question.length <= 90 ? "medium" : "small";
  const handedOver = handover !== null;
  const earthConfig = frame && layout ? JSON.stringify({ layout, width: frame.width, height: frame.spaceHeight, turn: frame.turn, level: frame.level ?? null }) : undefined;
  const variables = {
    "--page": frame && handedOver ? `${frame.width}px` : undefined,
    "--left": handover?.left ? `${handover.left}px` : undefined,
    "--sky-top": handover?.skyTop === undefined ? undefined : `${handover.skyTop}px`,
    "--question-top": handover?.questionTop === undefined ? undefined : `${handover.questionTop}px`,
  } as React.CSSProperties;
  return (
    <div
      ref={stage}
      id="question-stage"
      data-earth-config={earthConfig}
      // earth.js marks the level it chose here before React takes the page over.
      suppressHydrationWarning
      className={styles.stage}
      style={variables} data-handover={handedOver ? "" : undefined}>
      <div className={styles.scene}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a fixed backdrop, sized by the stage */}
        <img ref={plate} className={styles.plate} src={SKY_PLATE} width={2560} height={820} alt="" decoding={handedOver ? "sync" : "async"} fetchPriority="high" />
        {[0, 1, 2].map((group) => (
          <svg
            key={group}
            ref={(star) => {
              if (star) stars.current[group] = star;
            }}
            className={styles.stars}
            data-group={group} viewBox="0 0 2560 820" aria-hidden fill="#e6eaf5">
            {STARS.filter((star) => star.group === group).map((star) => (
              <circle key={`${star.x}-${star.y}`} cx={star.x} cy={star.y} r={star.r} opacity={star.opacity} />
            ))}
          </svg>
        ))}
        {/* Only at the lowest levels, where the sky's own twinkle is off. */}
        <div ref={glints} className={styles.glints} aria-hidden>
          {glintSpots.map((glint, i) => (
            <i key={`${glint.x}-${glint.y}`} style={{ left: glint.x, top: glint.y, animationDuration: `${GLINT_SLOTS * GLINT_SLOT_S}s`, animationDelay: `${-i * GLINT_SLOT_S}s` }} />
          ))}
        </div>
        <div ref={dawn} className={styles.dawn} aria-hidden />
        <div ref={sun} className={styles.sun} aria-hidden />
        {frame && layout && rings && (
          <div ref={space} className={styles.space} style={{ top: frame.spaceTop, height: frame.spaceHeight, width: frame.width }}>
            <div
              className={styles.glow}
              style={{ left: layout.cx - layout.R * 0.75, top: layout.cy - layout.R * 0.66, width: layout.narrow ? 800 : 1400, height: 2 * (frame.spaceHeight - layout.cy + layout.R * 0.66) }}
              aria-hidden
            />
            <svg data-ring="back" className={styles.ring} aria-hidden suppressHydrationWarning dangerouslySetInnerHTML={{ __html: rings.back }} />
            {/* The ring's spark, moved only by a transform, so nothing is redrawn as it goes round: behind the planet here. */}
            <i data-spark="back" className={styles.spark} aria-hidden suppressHydrationWarning />
            <div data-still suppressHydrationWarning className={styles.stillBox} style={{ "--fade": `${layout.narrow ? 56 : 96}px` } as React.CSSProperties}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a frame of the shader, placed to the pixel */}
              <img
                className={styles.still}
                src={EARTH_STILL}
                alt=""
                decoding={handedOver ? "sync" : "async"}
                fetchPriority="high"
                style={{ left: layout.cx - layout.R * STILL_REACH, top: layout.cy - layout.R * STILL_REACH, width: layout.R * STILL_REACH * 2 }}
              />
            </div>
            {/* earth.js sizes and draws it, and marks it live, before React takes the page over. */}
            <canvas className={styles.earth} aria-hidden suppressHydrationWarning />
            <svg data-ring="front" className={styles.ring} aria-hidden suppressHydrationWarning dangerouslySetInnerHTML={{ __html: rings.front }} />
            <i data-spark="front" className={styles.spark} aria-hidden suppressHydrationWarning />
          </div>
        )}
      </div>
      <div ref={wash} className={styles.wash} aria-hidden />
      <div className={styles.head}>
      <h1 ref={headline} className={styles.question} data-size={size} data-flying={flying ? "" : undefined}>
        {words.map((word, i) => (
          <span
            key={i}
            className={styles.word}
            data-lit={word.concept !== undefined ? "" : undefined}
            style={{ "--i": i, "--m": word.concept === undefined ? undefined : CONCEPT_COLOURS[word.concept % CONCEPT_COLOURS.length] } as React.CSSProperties}
          >
            {word.text}
          </span>
        ))}
      </h1>
      <StageStatus lit={lit} gone={flying} />
      </div>
    </div>
  );
}

/**
 * What's under way, in plain words: only real steps, shown once the wait is long enough to need them, with the seconds
 * once it's long. It's the stage's live region, so a screen reader hears the steps and not the question.
 */
function StageStatus({ lit, gone }: { lit: boolean; gone: boolean }) {
  const [seconds, setSeconds] = useState(0);
  // The clock is the outside system: the wait counted in whole seconds.
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  const step = lit ? "Finding papers" : "Writing a search query";
  return (
    <p className={styles.status} role="status" data-shown={seconds >= 1 && !gone ? "" : undefined}>
      <span key={step} className={styles.step}>
        {step}
        {seconds >= COUNT_AFTER_S && (
          <span aria-hidden className={styles.seconds}>
            {seconds}s
          </span>
        )}
      </span>
    </p>
  );
}
