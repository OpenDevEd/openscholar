/**
 * What the server needs to place the marketing hero's Earth (marketing/src/components/HomeHero.astro) and its ring.
 * The geometry matches the hero's exactly, so the hero can hand over to this unseen.
 */

const DIR = "/question-stage";
export const EARTH_IMAGES = [`${DIR}/earth-day.avif`, `${DIR}/earth-night.avif`, `${DIR}/earth-clouds.avif`, `${DIR}/earth-water.avif`];
export const SKY_PLATE = `${DIR}/sky-plate.avif`;
/** The planet in daylight, as the shader draws it, for a visitor who didn't come through the hero. */
export const EARTH_STILL = `${DIR}/earth-still.avif`;
/** How far the still reaches beyond the planet's radius, for its glow. */
export const STILL_REACH = 1.55;

/** The hero's sizes at a width, from its `size()`. */
export function earthLayout(W: number) {
  const [R, rx, k] =
    W >= 1400 ? [320, 620, 0.13] : W >= 1200 ? [250, W / 2 - 60, 0.12] : W >= 1000 ? [260, W / 2 - 60, 0.16] : W >= 700 ? [216, W / 2 - 44, 0.18] : [Math.min(150, W / 2 - 58), W / 2 - 30, 0.3];
  const narrow = W < 700;
  return { R, rx, ry: Math.min(rx * k, narrow ? 60 : 1e3), cx: W / 2, cy: R + (narrow ? 60 : 98), narrow, tilt: -0.1 };
}
type Layout = ReturnType<typeof earthLayout>;

/** The hero's height for its planet at a width, for a visitor who didn't come through the hero. */
export const spaceHeight = (W: number) => (W >= 1400 ? 562 : W >= 1200 ? 478 : W >= 1000 ? 504 : W >= 700 ? 448 : 302);

const COMET: [number, number, number][] = [
  [150, 1.2, 0.3],
  [70, 1.8, 0.6],
  [22, 2.6, 1],
];

/** One half of the ring as the hero draws it, behind the planet or in front of it, as SVG the server can send. */
export function ringMarkup({ rx: a, ry: b, cx, cy, tilt, narrow }: Layout, front: boolean) {
  const id = front ? "stage-ring-front" : "stage-ring-back";
  const sweep = front ? 0 : 1;
  const arc = `M ${-a} 0 A ${a} ${b} 0 0 ${sweep} ${a} 0`;
  const band = (rb: number, t: number) => `M ${-a} 0 A ${a} ${rb} 0 0 ${sweep} ${a} 0 A ${a} ${rb - t} 0 0 ${1 - sweep} ${-a} 0 Z`;
  const paint = `url(#${id})`;
  const fill = (d: string, opacity: number) => `<path d="${d}" fill="${paint}" opacity="${opacity}"/>`;
  const k = front ? 1 : 0.35;
  const o = front ? 1 : 0.5;
  const body = narrow ? 9 : 18;
  const inset = narrow ? 8 : 16;
  return [
    `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${-a}" x2="${a}" y1="0" y2="0"><stop offset="0" stop-color="#ff6b35"/><stop offset=".16" stop-color="#ff9d36"/><stop offset=".34" stop-color="#ffd9ae"/><stop offset=".52" stop-color="#8fd3d8"/><stop offset=".76" stop-color="#5a9be6"/><stop offset="1" stop-color="#3c62b8"/></linearGradient><filter id="${id}-soft" x="-5%" y="-100%" width="110%" height="300%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="9"/></filter></defs>`,
    `<g transform="translate(${cx} ${cy}) rotate(${(tilt * 180) / Math.PI})">`,
    `<path d="${arc}" fill="none" stroke="${paint}" stroke-width="14" opacity="${front ? 0.16 : 0.08}" filter="url(#${id}-soft)"/>`,
    `<path d="${arc}" fill="none" stroke="${paint}" stroke-width="1" opacity="${0.85 * o}"/>`,
    fill(band(b, body * k), 0.06 * o),
    fill(band(b, 2.2 * k), o),
    fill(band(b - inset * k, 1.2 * k), 0.55 * o),
    fill(band(b - inset * 0.5 * k, 0.8 * k), 0.35 * o),
    narrow ? "" : fill(band(b + 7 * k, 0.8 * k), 0.3 * o),
    // The comet's three dashes share a head, so it tapers.
    ...COMET.map(([length, width, opacity]) => `<path data-comet="${length}" d="${arc}" fill="none" stroke="#fff1e0" stroke-width="${width}" opacity="${opacity}" pathLength="1000" stroke-dasharray="${length} ${2000 - length}" stroke-linecap="round" visibility="hidden"/>`),
    `</g>`,
  ].join("");
}

/** The planet itself is public/question-stage/earth.js, which runs before the app's scripts. */
export const EARTH_SCRIPT = `${DIR}/earth.js`;
export type Earth = { wave(): void; sunBehind(ms: number): void; stop(): void };
export type EarthConfig = { layout: Layout; width: number; height: number; turn: { t: number; at: number } | null };
declare global {
  interface Window {
    questionStageEarth?: { boot(script: Element, config: EarthConfig): void };
    questionStageEarthRun?: Earth;
  }
}
