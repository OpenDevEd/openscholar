import { createField, readPapers, mat3Tilt, I3 } from "./field.js";
import { shapes, cover, IMG } from "./shapes.js";
import search from "../data/search-default.json";

// One journey of light. Every shape is drawn in the coordinates of the photograph it lines up with, so the beam really enters the telescope, splits at the prism and lands on the plate.
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (t) => t * t * (3 - 2 * t);

// Chapters, in the order of the page. `t` is the shape, `f` the point of the photo to keep in view on a narrow screen.
const CH = [{ t: 0 }, { t: 0 }, { t: 1, f: 0.67 }, { t: 2, f: 0.68 }, { t: 3, f: 0.66 }, { t: 4, f: 0.8 }, { t: 5, f: 0.5 }, { t: 6, f: 0.79 }, { t: 7, f: 0.5 }];
const sections = [...document.querySelectorAll("[data-ch]")], copies = sections.map((s) => s.querySelector("[data-copy]")), photos = CH.map((_, i) => document.querySelector(`[data-photo="${i}"]`));
const canvas = document.querySelector("[data-field]"), said = document.querySelector("[data-said]"), lines = [...said.querySelectorAll("span")], steps = [...document.querySelectorAll("[data-step]")], etched = document.querySelector("[data-etched]");
let tops = [], sayTop = 0, sayH = 0, vw = 0, vh = 0, scale = 1, narrow = false;
function measure() {
  const y = scrollY; vw = innerWidth; vh = innerHeight; const asp = vw / vh; narrow = vw < 900; scale = Math.max(1, asp / IMG);
  tops = sections.map((s) => s.getBoundingClientRect().top + y); const r = said.closest("section").getBoundingClientRect(); sayTop = r.top + y; sayH = r.height;
  // On a narrow screen, slide each photo so its subject stays in view, and move the camera with it.
  photos.forEach((p, i) => { if (!p) return; const c = cover(asp, CH[i].f); p.style.objectPosition = `${(c.pos * 100).toFixed(2)}% 50%`; CH[i].pan = c.pan; });
  // The library's page sits on the glass plate, in the plate's own perspective.
  const cw = Math.max(vw, vh * IMG), ch = cw / IMG, ox = (vw - cw) * cover(asp, CH[7].f).pos, oy = (vh - ch) / 2, W = 1000, H = 782;
  etched.style.transform = `matrix(${0.218 * cw / W}, ${-0.01 * ch / W}, ${-0.01 * cw / H}, ${0.3 * ch / H}, ${ox + 0.69 * cw}, ${oy + 0.32 * ch})`;
}
measure(); addEventListener("resize", measure, { passive: true });
const chapterAt = (y) => { for (let i = sections.length - 1; i >= 1; i--) { const start = tops[i] - vh * 0.85, end = tops[i] - vh * 0.1; if (y >= start) return i - 1 + clamp((y - start) / (end - start)); } return 0; };

let field = null, cur = 0, then = 0, shown = false, pull = 0, pulling = 0, active = -1, ringAt = -9, tick = 0, lastY = -1;
document.querySelectorAll("[data-ask-input]").forEach((a) => { a.addEventListener("focus", () => { pulling = 1; }); a.addEventListener("blur", () => { pulling = 0; }); a.addEventListener("input", () => { ringAt = performance.now() / 1000; }); });

function frame(ms) {
  requestAnimationFrame(frame);
  if (document.hidden) return;
  const t = ms / 1000, dt = Math.min(0.05, t - then); then = t;
  const y = scrollY, target = chapterAt(y);
  const moving = Math.abs(target - cur) > 0.0005;
  cur = reduced || !moving ? target : cur + (target - cur) * (1 - Math.exp(-dt * 6));
  const a = Math.min(CH.length - 1, Math.floor(cur)), b = Math.min(CH.length - 1, a + 1), m = cur - a, e = smooth(m);
  // Only the chapters on screen are touched.
  const now = Math.round(cur);
  if (moving || now !== active || y !== lastY) {
    lastY = y;
    copies.forEach((c, i) => { const near = Math.abs(cur - i); if (near > 1.2) { if (c.style.visibility !== "hidden") { c.style.visibility = "hidden"; c.style.opacity = 0; } return; } const al = i === 0 ? clamp(1 - cur * 2.4) : clamp(1.25 - near * 2.6); c.style.visibility = al > 0.01 ? "visible" : "hidden"; c.style.opacity = al; c.style.transform = `translate3d(0, ${(i - cur) * 70}px, 0)`; });
    photos.forEach((p, i) => { if (!p) return; const al = clamp(1.3 - Math.abs(cur - i) * 1.9); p.style.opacity = al; p.style.visibility = al > 0.01 ? "visible" : "hidden"; if (i === 7) { etched.style.opacity = al; etched.style.visibility = p.style.visibility; } });
    // One sentence a screen, each lit as it passes, with the stars dimmed behind them.
    const sp = clamp((y - sayTop + vh * 0.2) / (sayH - vh * 0.75)) * lines.length; if (y > sayTop - vh && y < sayTop + sayH) { lines.forEach((l, i) => { const d = sp - i - 0.5, al = clamp(1.6 - Math.abs(d) * 3.4); l.style.opacity = al; l.style.transform = `translate3d(0, ${d * -60}px, 0) scale(${1 - d * 0.05})`; }); }
    if (shown) canvas.style.opacity = 1 - 0.72 * clamp(1.4 - Math.abs(cur - 1) * 2.4);
    const st = clamp((cur - 4.75) / 0.5); steps.forEach((el, i) => el.toggleAttribute("data-done", st > (i + 0.3) / steps.length));
    active = now;
  }
  if (!field) return;
  // Half the frames when nothing is moving: the stars only shimmer.
  const age = t - ringAt, rippling = age < 2, idle = !moving && !rippling && Math.abs(pulling - pull) < 0.01;
  if (idle && tick++ % 2) return;
  pull += (pulling - pull) * (1 - Math.exp(-dt * 3));
  const TA = CH[a].t, TB = CH[b].t, fly = smooth(clamp((y - tops[1] + vh * 0.5) / (sayH - vh * 0.2))), tm = reduced ? 0 : t, tilt = mat3Tilt(1.0 - fly * 0.45, tm * 0.016);
  const hx = narrow ? 0 : -0.62, hy = narrow ? -0.2 : -0.28, hz = (narrow ? 4.9 : 3.0) - Math.pow(fly, 1.6) * (narrow ? 4.3 : 2.5);
  const camOf = (i) => (i <= 1 ? [hx * (1 - fly), hy * (1 - fly), hz] : [CH[i].pan ?? 0, 0, 2.66]);
  const A = camOf(a), B = camOf(b), ex = A[0] + (B[0] - A[0]) * e, ey = A[1] + (B[1] - A[1]) * e, ez = A[2] + (B[2] - A[2]) * e;
  const rot = (s) => (s === 0 ? tilt : I3), same = TA === TB;
  field.render({ a: TA, b: TB, mix: same ? 0 : m, time: tm, eye: [ex, ey, ez], center: [ex, ey, 0], rotA: rot(TA), rotB: rot(TB), swirl: 0.3, moving: !reduced && !same, scaleA: TA === 0 ? 1 : scale, scaleB: TB === 0 ? 1 : scale, pull, ring: rippling && TA === 0 ? Math.exp(-age * 1.8) : 0, ringR: age * 1.5, idle });
  if (!shown) { shown = true; canvas.style.opacity = 1; setTimeout(() => { canvas.style.transition = "none"; }, 1500); }
}
requestAnimationFrame(frame);

const QUESTIONS = ["Does peer tutoring improve reading?", "What keeps girls in school?", "Is mindfulness as good as medication for anxiety?", "How does heat affect learning?", "Do cash transfers reduce poverty for good?"];
const asks = [...document.querySelectorAll("[data-ask-input]")];
if (!reduced) { let q = 0, c = QUESTIONS[0].length, del = true, wait = 30; setInterval(() => { if (document.hidden || asks.some((a) => a === document.activeElement || a.value)) return; if (wait > 0) { wait--; return; } if (del) { c -= 2; if (c <= 0) { del = false; q = (q + 1) % QUESTIONS.length; c = 0; } } else { c += 1; if (c >= QUESTIONS[q].length) { del = true; wait = 40; } } asks.forEach((a) => { a.placeholder = QUESTIONS[q].slice(0, Math.max(0, c)); }); }, 55); }

const idle = (f) => (window.requestIdleCallback ? requestIdleCallback(f, { timeout: 500 }) : setTimeout(f, 80));
const pause = () => new Promise((r) => idle(r));
idle(async () => {
  try {
    const bytes = new Uint8Array(await (await fetch("/data/field.bin")).arrayBuffer()), max = bytes.length / 3, count = innerWidth < 900 ? Math.min(max, 70000) : max;
    const p = readPapers(bytes, count); await pause();
    const S = shapes(count, p.seedA, p.bright, { bars: narrow ? [] : Array.from({ length: 30 }, (_, k) => search.years.find(([y]) => y === 1997 + k)?.[1] ?? 0) }), mk = (f) => { const d = new Float32Array(count * 4); f(d); return d; };
    const targets = [{ data: mk(p.galaxy), warm: 0.9 }]; await pause();
    for (const [f, wave, dir] of [[S.telescope, 0.5, [0.45, -0.9]], [S.prism, 0.55, [1, 0]], [S.spectrum, 0.22, [0.64, 0.77]], [S.console, 0.3, [0.5, 0.5]], [S.array, 0.35, [0, 1]], [S.plate, 0.4, [0.7, -0.7]], [S.horizon, 0.3, [1, 0]]]) { targets.push({ data: mk(f), wave, dir }); await pause(); }
    field = createField(canvas, { count, seeds: p.seedA, targets, sizeScale: count < max ? 1.25 : 1 });
    if (!field) canvas.remove();
  } catch (e) { console.error("Field:", e); canvas.remove(); }
});
