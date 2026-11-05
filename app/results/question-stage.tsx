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
const FLIGHT_MS = 1000;
const OPEN_MS = 1150;

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
 * written the words it uses light up, and once the page behind has its results the question's words
 * fly into the real research question field as the sky opens around it.
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
    for (const image of [plate.current!, still.current!]) void image.decode().then(() => (image.dataset.in = ""), () => {});
    const earth = startEarth(canvas.current!, ringBack.current!, ringFront.current!, space.current!, calm, () => setLive(true));
    const started = performance.now();
    let litAt = 0;
    let raf = 0;
    let finish = 0;

    const land = () => {
      const field = document.querySelector<HTMLElement>("[data-question-field]");
      const input = field?.querySelector("input") ?? null;
      const box = input?.getBoundingClientRect();
      const target = box && box.width > 0 && box.top < innerHeight ? box : null;
      setFlying(true);

      if (calm) {
        stage.current!.style.transition = "opacity .3s";
        stage.current!.style.opacity = "0";
        finish = window.setTimeout(() => setDone(true), 320);
        return;
      }

      const x = target ? target.left + Math.min(180, target.width / 2) : innerWidth / 2;
      const y = target ? target.top + target.height / 2 : innerHeight / 2;
      const root = stage.current!;
      root.style.setProperty("--rx", `${x}px`);
      root.style.setProperty("--ry", `${y}px`);
      root.dataset.opening = "";
      const far = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 300;
      const openedAt = performance.now();
      const open = (now: number) => {
        const k = Math.min(1, (now - openedAt) / OPEN_MS);
        root.style.setProperty("--r", `${(k ** 2.2 * far).toFixed(1)}px`);
        rim.current!.style.opacity = String(Math.min(1, k * 5) * (1 - k ** 6));
        if (k < 1) raf = requestAnimationFrame(open);
      };
      raf = requestAnimationFrame(open);
      earth.leave(OPEN_MS);

      // Each word goes to the place it has in the field's one line, at the field's own size and colour.
      const spans = [...headline.current!.children] as HTMLElement[];
      if (!target || !input) {
        for (const span of spans) span.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: "forwards" });
      } else {
        const font = getComputedStyle(input);
        const ruler = document.createElement("div");
        ruler.style.cssText = `position:fixed;left:${target.left}px;top:${target.top}px;height:${target.height}px;display:flex;align-items:center;white-space:pre;visibility:hidden;font:${font.font};letter-spacing:${font.letterSpacing}`;
        const marks = spans.map((span, i) => {
          const mark = document.createElement("span");
          mark.textContent = `${span.textContent}${i < spans.length - 1 ? " " : ""}`;
          return ruler.appendChild(mark);
        });
        document.body.append(ruler);
        const space = marks.length > 1 ? marks[0].getBoundingClientRect().width - measure(ruler, spans[0].textContent ?? "") : 0;
        spans.forEach((span, i) => {
          const from = span.getBoundingClientRect();
          const pad = parseFloat(getComputedStyle(span).paddingLeft);
          const to = marks[i].getBoundingClientRect();
          const scale = (to.width - (i < spans.length - 1 ? space : 0)) / (from.width - pad * 2);
          const dx = to.left - from.left - pad * scale;
          const dy = to.top + to.height / 2 - (from.top + (from.height * scale) / 2);
          const past = to.left > target.right - 8;
          span.animate(
            [
              { transform: "none", color: "#ffe6cf", opacity: 1, offset: 0 },
              { color: font.color, opacity: past ? 0 : 1, offset: 0.9 },
              { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, color: font.color, opacity: 0, offset: 1 },
            ],
            { duration: FLIGHT_MS, delay: Math.min(i * 16, 200), easing: "cubic-bezier(.55,0,.15,1)", fill: "both" },
          );
        });
        ruler.remove();
      }
      finish = window.setTimeout(() => setDone(true), OPEN_MS + 60);
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
  }, [question, holdMs, frame]);

  if (!question || done) return null;

  const size = question.length <= 40 ? "large" : question.length <= 90 ? "medium" : "small";
  const handedOver = handover !== null;
  const variables = {
    "--page": frame && handedOver ? `${frame.width}px` : undefined,
    "--sky-top": handover?.skyTop === undefined ? undefined : `${handover.skyTop}px`,
    "--question-top": handover?.questionTop === undefined ? undefined : `${handover.questionTop}px`,
  } as React.CSSProperties;
  return (
    <div ref={stage} className={styles.stage} style={variables} data-handover={handedOver ? "" : undefined} aria-busy="true">
      <div className={styles.scene}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a fixed backdrop, sized by the stage */}
        <img ref={plate} className={styles.plate} src={SKY_PLATE} width={2560} height={820} alt="" decoding={handedOver ? "sync" : "async"} fetchPriority="high" />
        {[0, 1, 2].map((group) => (
          <svg key={group} className={styles.stars} data-group={group} viewBox="0 0 2560 820" aria-hidden fill="#e6eaf5">
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

/** How wide a piece of text is in the ruler's font. */
function measure(ruler: HTMLElement, text: string) {
  const span = document.createElement("span");
  span.textContent = text;
  ruler.append(span);
  const width = span.getBoundingClientRect().width;
  span.remove();
  return width;
}
