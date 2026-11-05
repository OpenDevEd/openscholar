"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { preload } from "react-dom";
import { useSearchParams } from "next/navigation";
import { parseSearchParamsFromUrl, readUrlQuestion } from "@/lib/search-params";
import { highlightSegments, queryMatcher } from "@/lib/search/boolean-query";
import { useQuestionStage } from "@/lib/search/question-stage";
import { earthLayout, ringMarkup, spaceHeight, startEarth, EARTH_IMAGES, EARTH_STILL, SKY_PLATE, STILL_REACH } from "./question-stage-earth";
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
/** How long the question takes to fall into the planet, its lift included. The sky opens as it arrives. */
const FALL_MS = 900;
/** How much later the farthest word sets off than the nearest. */
const WORD_STAGGER_MS = 160;
/** How much of the fall is the lift before it. */
const LIFT = 0.2;
const OPEN_MS = 1150;
/** How much of the gap between them the planet covers, and its most in pixels. The words cover the rest. */
const RISE_SHARE = 0.5;
const RISE_MAX = 170;
/** How small a word has got as it enters the planet. */
const WORD_END = 0.18;

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

/** Where things are on the screen: the page width, the sky's top, the planet's box, and the question's top. */
type Frame = { width: number; skyTop?: number; spaceTop: number; spaceHeight: number; questionTop?: number };

/** The hero's measurements, sent in the address so the first paint lands exactly on its last frame. */
function readHandover(value: string | null): Frame | null {
  const numbers = value?.split(",").map(Number) ?? [];
  if (numbers.length !== 5 || numbers.some((n) => !Number.isFinite(n) || Math.abs(n) > 10000)) return null;
  const [width, skyTop, spaceTop, height, questionTop] = numbers;
  return width > 0 && height > 0 ? { width, skyTop, spaceTop, spaceHeight: height, questionTop } : null;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
/** Keyframes sampled from a curve: CSS easing moves everything along one line at one rate, and this needs several at once. */
const sampled = (steps: number, at: (t: number) => Keyframe) => Array.from({ length: steps + 1 }, (_, i) => at(i / steps));

/**
 * One word's way into the planet. It lifts as if drawing breath, falls under something like gravity, and only gathers
 * towards the point late on, so its path curves and it doesn't run into its neighbours while it's still big.
 */
function wordFall(dx: number, dy: number, side: number) {
  return sampled(44, (t) => {
    const lift = t < LIFT ? Math.sin((t / LIFT) * Math.PI) : 0;
    const u = clamp01((t - LIFT) / (1 - LIFT));
    const x = dx * u ** 3;
    const y = dy * u ** 1.9 - 12 * lift;
    const scale = 1 + 0.03 * lift - (1 - WORD_END) * smooth(u);
    return { transform: `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${(side * 10 * u ** 2.4).toFixed(2)}deg) scale(${scale.toFixed(4)})`, opacity: clamp01((1 - u) / 0.08) };
  });
}

/** The planet's part: it dips as the words lift, rises to meet them, gives under the impact, then the camera goes in. */
function planetMeet(rise: number) {
  const total = FALL_MS + OPEN_MS;
  return sampled(80, (t) => {
    const ms = t * total;
    const dip = ms < FALL_MS * LIFT ? 8 * Math.sin((ms / (FALL_MS * LIFT)) * Math.PI) : 0;
    const u = clamp01((ms - FALL_MS * LIFT) / (FALL_MS * (1 - LIFT)));
    const after = Math.max(0, ms - FALL_MS) / 1000;
    const give = 16 * Math.exp(-5 * after) * Math.sin(11 * after);
    const scale = 1 + 0.03 * u ** 2 + 0.012 * Math.exp(-5 * after) * Math.sin(11 * after) + 0.37 * smooth(clamp01((ms - FALL_MS) / OPEN_MS)) ** 1.6;
    return { transform: `translateY(${(dip - rise * u ** 2.2 + give).toFixed(2)}px) scale(${scale.toFixed(4)})` };
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
 * written the words it uses light up, and once the page behind has its results the question falls
 * into the planet as it rises to meet it, and the sky opens from where they touch.
 */
export function QuestionStage() {
  const params = useSearchParams();
  const [question] = useState(() => (parseSearchParamsFromUrl(params).q?.trim() ? "" : readUrlQuestion(params)));
  // Mock only: seconds to hold the stage, to watch it longer than a real answer takes.
  const [holdMs] = useState(() => Number(params.get("hold") ?? 0) * 1000);
  const [handover] = useState(() => readHandover(params.get("hero")));
  const [frame, setFrame] = useState<Frame | null>(handover);
  const [live, setLive] = useState(false);
  const [lit, setLit] = useState(false);
  const [flying, setFlying] = useState(false);
  const [done, setDone] = useState(false);
  const query = useQuestionStage((state) => state.query);
  const stage = useRef<HTMLDivElement>(null);
  const space = useRef<HTMLDivElement>(null);
  const rim = useRef<HTMLDivElement>(null);
  const plate = useRef<HTMLImageElement>(null);
  const still = useRef<HTMLImageElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const ringBack = useRef<SVGSVGElement>(null);
  const ringFront = useRef<SVGSVGElement>(null);
  const headline = useRef<HTMLHeadingElement>(null);
  const spark = useRef<HTMLDivElement>(null);
  const stars = useRef<SVGSVGElement[]>([]);
  const words = useMemo(() => questionWords(question, lit ? query : null), [question, lit, query]);
  const layout = useMemo(() => (frame ? earthLayout(frame.width) : null), [frame]);
  const rings = useMemo(() => (layout ? { back: ringMarkup(layout, false), front: ringMarkup(layout, true) } : null), [layout]);

  if (question) {
    for (const src of [SKY_PLATE, EARTH_STILL]) preload(src, { as: "image", fetchPriority: "high" });
    for (const src of EARTH_IMAGES) preload(src, { as: "image" });
  }

  // WebGL, the frame clock and the page behind are all outside React: this reads the page's field
  // from the DOM and moves the question's words by hand, so nothing here re-renders while it flies.
  useEffect(() => {
    if (!question) return;
    // Nobody measured the screen for a visitor who came straight here, so it's done now and the planet fades in.
    if (!frame) {
      const height = spaceHeight(innerWidth);
      setFrame({ width: innerWidth, spaceTop: Math.max(innerWidth < 700 ? 230 : 200, innerHeight - height - 70), spaceHeight: height });
      return;
    }
    const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
    stage.current!.dataset.moving = "";
    for (const image of [plate.current!, still.current!]) void image.decode().then(() => (image.dataset.in = ""), () => {});
    const earth = startEarth(canvas.current!, ringBack.current!, ringFront.current!, space.current!, calm, () => setLive(true));
    const started = performance.now();
    let litAt = 0;
    let raf = 0;
    let finish = 0;
    // The component stays mounted once it's done, so the planet has to be stopped here.
    const end = () => {
      cancelAnimationFrame(raf);
      earth.stop();
      setDone(true);
    };

    // The question falls into the planet as the planet rises to meet it, and the sky opens from where they touch.
    const land = () => {
      setFlying(true);

      if (calm || !layout) {
        delete document.documentElement.dataset.questionStage;
        stage.current!.style.transition = "opacity .3s";
        stage.current!.style.opacity = "0";
        finish = window.setTimeout(end, 320);
        return;
      }

      const root = stage.current!;
      const planet = space.current!;
      for (const motion of planet.getAnimations()) motion.pause();
      const box = planet.getBoundingClientRect();
      const spans = [...headline.current!.children] as HTMLElement[];
      const question = headline.current!.getBoundingClientRect();
      const top = box.top + layout.cy - layout.R;
      const rise = Math.min(Math.max(0, top - question.bottom) * RISE_SHARE, RISE_MAX);
      const x = box.left + layout.cx;
      // A little inside the planet's edge, so the words go into it rather than stopping at it.
      const y = top - rise + layout.R * 0.07;

      const centres = spans.map((span) => span.getBoundingClientRect()).map((r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 }));
      const farthest = Math.max(1, ...centres.map((c) => Math.hypot(c.x - x, c.y - y)));
      spans.forEach((span, i) => {
        span.style.transformOrigin = "50% 50%";
        const near = Math.hypot(centres[i].x - x, centres[i].y - y) / farthest;
        span.animate(wordFall(x - centres[i].x, y - centres[i].y, Math.sign(centres[i].x - x)), {
          duration: FALL_MS - WORD_STAGGER_MS,
          // The words nearest the point go first and the rest pour in after them.
          delay: near * WORD_STAGGER_MS,
          fill: "both",
        });
      });

      planet.style.transformOrigin = `${layout.cx}px ${y - box.top}px`;
      planet.animate(planetMeet(rise), { duration: FALL_MS + OPEN_MS, fill: "forwards" });

      // Light gathers where the words are going in, and the opening starts from it.
      const glow = spark.current!;
      glow.style.left = `${x}px`;
      glow.style.top = `${y}px`;
      glow.animate(
        [
          { opacity: 0, transform: "translate(-50%, -50%) scale(.15)", easing: "cubic-bezier(.5,0,.9,.5)", offset: 0 },
          { opacity: 0, transform: "translate(-50%, -50%) scale(.15)", easing: "cubic-bezier(.5,0,.9,.5)", offset: 0.38 },
          { opacity: 1, transform: "translate(-50%, -50%) scale(1)", easing: "ease-out", offset: 0.74 },
          { opacity: 0, transform: "translate(-50%, -50%) scale(1.6)", offset: 1 },
        ],
        { duration: FALL_MS + 300, fill: "forwards" },
      );

      finish = window.setTimeout(() => {
        delete document.documentElement.dataset.questionStage;
        earth.wave();
        root.style.setProperty("--rx", `${x}px`);
        root.style.setProperty("--ry", `${y}px`);
        root.dataset.opening = "";
        // Going through: what's nearer the camera rushes past faster than what's far away.
        for (const [layer, scale] of [[plate.current!, 1.06], ...stars.current!.map((star, i) => [star, 1.12 + i * 0.06] as const)] as const) {
          const place = layer.getBoundingClientRect();
          layer.style.transformOrigin = `${x - place.left}px ${y - place.top}px`;
          layer.animate([{ transform: "none" }, { transform: `scale(${scale})` }], { duration: OPEN_MS, easing: "cubic-bezier(.7,0,.2,1)", fill: "forwards" });
        }
        const far = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 300;
        const openedAt = performance.now();
        const open = (now: number) => {
          const k = Math.min(1, (now - openedAt) / OPEN_MS);
          // Slow to catch, then all at once, easing as it leaves the screen.
          const eased = k < 0.5 ? 8 * k ** 4 : 1 - (-2 * k + 2) ** 4 / 2;
          root.style.setProperty("--r", `${(eased * far).toFixed(1)}px`);
          rim.current!.style.opacity = String(Math.min(1, k * 8) * (1 - k ** 6));
          if (k < 1) raf = requestAnimationFrame(open);
          else end();
        };
        raf = requestAnimationFrame(open);
      }, FALL_MS - 50);
    };
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (!litAt) {
        if (useQuestionStage.getState().query !== null && now - started >= Math.max(LEAST_MS - LIT_MS, holdMs)) {
          litAt = now;
          setLit(true);
          earth.wave();
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
      earth.stop();
    };
  }, [question, holdMs, frame, layout]);

  if (!question || done) return null;

  const size = question.length <= 40 ? "large" : question.length <= 90 ? "medium" : "small";
  const handedOver = handover !== null;
  const variables = {
    "--page": frame && handedOver ? `${frame.width}px` : undefined,
    "--sky-top": handover?.skyTop === undefined ? undefined : `${handover.skyTop}px`,
    "--question-top": handover?.questionTop === undefined ? undefined : `${handover.questionTop}px`,
  } as React.CSSProperties;
  return (
    <div ref={stage} id="question-stage" className={styles.stage} style={variables} data-handover={handedOver ? "" : undefined} aria-busy="true">
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
        {frame && layout && rings && (
          <div ref={space} className={styles.space} style={{ top: frame.spaceTop, height: frame.spaceHeight, width: frame.width, "--space-foot": `${frame.spaceTop + frame.spaceHeight}px` } as React.CSSProperties}>
            <div
              className={styles.glow}
              style={{ left: layout.cx - layout.R * 0.75, top: layout.cy - layout.R * 0.66, width: layout.narrow ? 800 : 1400, height: 2 * (frame.spaceHeight - layout.cy + layout.R * 0.66) }}
              aria-hidden
            />
            <svg ref={ringBack} className={styles.ring} aria-hidden dangerouslySetInnerHTML={{ __html: rings.back }} />
            <div className={styles.stillBox} data-live={live ? "" : undefined} style={{ "--fade": `${layout.narrow ? 56 : 96}px` } as React.CSSProperties}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a frame of the shader, placed to the pixel */}
              <img
                ref={still}
                className={styles.still}
                src={EARTH_STILL}
                alt=""
                decoding={handedOver ? "sync" : "async"}
                fetchPriority="high"
                style={{ left: layout.cx - layout.R * STILL_REACH, top: layout.cy - layout.R * STILL_REACH, width: layout.R * STILL_REACH * 2 }}
              />
            </div>
            <canvas ref={canvas} className={styles.earth} data-live={live ? "" : undefined} aria-hidden />
            <svg ref={ringFront} className={styles.ring} aria-hidden dangerouslySetInnerHTML={{ __html: rings.front }} />
          </div>
        )}
      </div>
      <div ref={rim} className={styles.rim} aria-hidden />
      <div ref={spark} className={styles.spark} aria-hidden />
      <h1 ref={headline} className={styles.question} data-size={size} data-flying={flying ? "" : undefined} role="status">
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
    </div>
  );
}
