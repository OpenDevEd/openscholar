"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { preload } from "react-dom";
import { useSearchParams } from "next/navigation";
import { parseSearchParamsFromUrl, readUrlQuestion } from "@/lib/search-params";
import { highlightSegments, queryMatcher } from "@/lib/search/boolean-query";
import { useQuestionStage } from "@/lib/search/question-stage";
import { startEarth, EARTH_IMAGES, SKY_PLATE } from "./question-stage-earth";
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

// Fixed in size and place, as on the marketing hero, so the server's first paint already has them.
const STARS = (() => {
  let seed = 11;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  return Array.from({ length: 300 }, (_, i) => {
    const big = i < 10;
    const small = random() < 0.85;
    const x = random() * 2560;
    const y = random() * 900;
    const r = big ? 1.4 + random() * 0.4 : small ? 0.5 + random() * 0.4 : 0.9 + random() * 0.4;
    const opacity = (big ? 0.9 : small ? 0.2 + random() * 0.4 : 0.7) * Math.min(1, (900 - y) / 270);
    return { x: x.toFixed(1), y: y.toFixed(1), r: r.toFixed(2), opacity: opacity.toFixed(2), group: i % 3 };
  });
})();

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
  const [lit, setLit] = useState(false);
  const [flying, setFlying] = useState(false);
  const [done, setDone] = useState(false);
  const query = useQuestionStage((state) => state.query);
  const stage = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  const rim = useRef<HTMLDivElement>(null);
  const plate = useRef<HTMLImageElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const ringBack = useRef<SVGSVGElement>(null);
  const ringFront = useRef<SVGSVGElement>(null);
  const headline = useRef<HTMLHeadingElement>(null);
  const words = useMemo(() => questionWords(question, lit ? query : null), [question, lit, query]);

  if (question) {
    for (const src of [...EARTH_IMAGES, SKY_PLATE]) preload(src, { as: "image", fetchPriority: src === EARTH_IMAGES[0] ? "high" : "auto" });
  }

  // WebGL, the frame clock and the page behind are all outside React: this reads the page's field
  // from the DOM and moves the question's words by hand, so nothing here re-renders while it flies.
  useEffect(() => {
    if (!question) return;
    const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sky = plate.current!;
    void sky.decode().then(() => (sky.dataset.in = ""), () => {});
    const earth = startEarth(canvas.current!, ringBack.current!, ringFront.current!, scene.current!, calm);
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
  }, [question, holdMs]);

  if (!question || done) return null;

  const size = question.length <= 40 ? "large" : question.length <= 90 ? "medium" : "small";
  return (
    <div ref={stage} className={styles.stage} aria-busy="true">
      <div ref={scene} className={styles.scene}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a fixed backdrop, sized by the stage */}
        <img ref={plate} className={styles.plate} src={SKY_PLATE} width={2560} height={820} alt="" decoding="async" />
        {[0, 1, 2].map((group) => (
          <svg key={group} className={styles.stars} data-group={group} viewBox="0 0 2560 900" aria-hidden fill="#e6eaf5">
            {STARS.filter((star) => star.group === group).map((star) => (
              <circle key={`${star.x}-${star.y}`} cx={star.x} cy={star.y} r={star.r} opacity={star.opacity} />
            ))}
          </svg>
        ))}
        <div className={styles.glow} aria-hidden />
        <svg ref={ringBack} className={styles.ring} aria-hidden />
        <canvas ref={canvas} className={styles.earth} aria-hidden />
        <svg ref={ringFront} className={styles.ring} aria-hidden />
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
