import { createField, makeShapes, mat3Tilt, mat3Y, I3, YEAR_FROM, ease } from "./field.js";

const canvas = document.querySelector("[data-field]");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const narrow = () => innerWidth < 900;
const sections = [...document.querySelectorAll("[data-ch]")];
const rows = 5, cols = 3;
const GATE = mat3Y(-0.62);
const gatePoint = (x, y) => [GATE[0] * x, y, GATE[2] * x];

const CAM = [
  { e: [0, -0.44, 3.15], c: [0, -0.44, 0], m: [0, -0.7, 5.6], mc: [0, -0.7, 0] },      // galaxy, above the headline
  { e: [1, -0.1, 3.5], c: [1, -0.1, 0], m: [0, -0.5, 5], mc: [0, -0.5, 0] },      // one arm lit, on the left
  { e: [-1.02, 0.74, 4.3], c: [-1.02, 0.74, 0], m: [0, 0.2, 5.6], mc: [0, 0.2, 0] },     // year bars, on the right
  { e: [0, 0.34, 3.5], c: [0, 0.34, 0], m: [0, 0.5, 6.4], mc: [0, 0.5, 0] },           // gates
  { e: [-0.5, 0, 3.2], c: [-0.5, 0, 0], m: [0.6, 0.5, 5.2], mc: [0.6, 0.5, 0] },    // matrix
  { e: [0, 0, 3.45], c: [0, 0, 0], m: [0, 0, 6.2], mc: [0, 0, 0] },                    // ring
  { e: [-0.95, 0, 3.7], c: [-0.95, 0, 0], m: [0, 0.6, 5.6], mc: [0, 0.6, 0] },         // globe, on the right
  { e: [0, 0, 3.6], c: [0, 0, 0], m: [0, -0.3, 5.4], mc: [0, -0.3, 0] },               // the mark
];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

let tops = [];
const measure = () => { const y = scrollY; tops = sections.map((s) => s.getBoundingClientRect().top + y); };
measure(); addEventListener("resize", measure, { passive: true });
// A chapter changes as its section slides up from the lower part of the screen, then holds while its copy is read.
const chapterAt = (y) => { const vh = innerHeight; for (let i = sections.length - 1; i >= 1; i--) { const start = tops[i] - vh * 0.92, end = tops[i] - vh * 0.08; if (y >= start) return i - 1 + clamp((y - start) / (end - start)); } return 0; };

const copies = sections.map((s) => s.querySelector("[data-copy]"));
const cap = document.querySelector("[data-cap]");
const typed = document.querySelector("[data-typed]"), typedText = typed?.dataset.typed ?? "";
const rail = [...document.querySelectorAll("[data-rail] a")];
const steps = [...document.querySelectorAll("[data-step]")];

let field = null, geo = {}, cur = 0, seen = 0, then = 0;
const yearLabels = [...document.querySelectorAll("[data-year]")], gateLabels = [...document.querySelectorAll("[data-gate]")], cellLabels = [...document.querySelectorAll("[data-cell]")];

const place = (el, p, alpha) => { el.style.transform = `translate(${p[0].toFixed(1)}px, ${p[1].toFixed(1)}px)`; el.style.opacity = alpha; el.style.visibility = alpha > 0.01 ? "visible" : "hidden"; };

function overlays(ch) {
  const near = (i) => clamp(1.2 - Math.abs(ch - i) * 3);
  copies.forEach((c, i) => { if (!c) return; const a = near(i); c.style.opacity = a; c.style.transform = `translateY(${(ch - i) * -42}px)`; c.style.visibility = a > 0.01 ? "visible" : "hidden"; c.toggleAttribute("inert", a < 0.5); });
  rail.forEach((r, i) => r.toggleAttribute("data-on", Math.round(ch) === i));
  if (typed) { const n = Math.round(clamp((ch - 0.15) / 0.7) * typedText.length); typed.textContent = typedText.slice(0, n); }
  const s = clamp((ch - 4.55) / 0.42); steps.forEach((el, i) => el.toggleAttribute("data-done", s > (i + 0.2) / steps.length));
  if (!field || !geo.years) return;
  const { W, H, cols: yc, top, X, m } = geo.years; const ya = narrow() ? 0 : near(2);
  yearLabels.forEach((el) => { const y = +el.dataset.year, n = +el.dataset.count; const x = -W / 2 + (W / yc) * (y - YEAR_FROM + 0.37), p = field.project(x, el.dataset.at === "top" ? n / m * H + 0.05 : -0.06); if (p) place(el, p, ya); });
  const ga = narrow() ? 0 : near(3); gateLabels.forEach((el, i) => { const p = field.project(...gatePoint([-0.85, 0, 0.85][i], 0.52)); if (p) place(el, p, ga); });
  const ca = narrow() ? 0 : near(4), g = geo.matrix; cellLabels.forEach((el) => { const r = +el.dataset.r, c = +el.dataset.c; const p = field.project(c < 0 ? g.X0 : g.X0 + c * g.cw + g.cw * 0.5, r < 0 ? g.H / 2 + 0.08 : g.H / 2 - r * g.ch - g.ch * 0.5); if (p) place(el, p, ca); });
}

function frame(ms) {
  requestAnimationFrame(frame);
  if (document.hidden) return;
  const time = ms / 1000, dt = Math.min(0.05, time - then); then = time;
  const target = chapterAt(scrollY);
  cur += (target - cur) * (reduced ? 1 : 1 - Math.exp(-dt * 6));
  if (Math.abs(target - cur) < 0.0005) cur = target;
  overlays(cur);
  if (!field) return;
  if (innerHeight + scrollY > document.documentElement.scrollHeight + 1) return;
  const a = Math.min(7, Math.floor(cur)), b = Math.min(7, a + 1), mix = cur - a, t = ease(mix), n = narrow();
  const A = CAM[a], B = CAM[b];
  const tNow = reduced ? 0 : time;
  const rot = (i) => i <= 1 ? mat3Tilt(1.02, tNow * 0.014) : i === 6 ? mat3Y(-0.3 + tNow * 0.1) : i === 3 ? GATE : I3;
  field.render({ a, b, mix, time: tNow, eye: lerp3(n ? A.m : A.e, n ? B.m : B.e, t), center: lerp3(n ? A.mc : A.c, n ? B.mc : B.c, t), swirl: 0.34, rotA: rot(a), rotB: rot(b), moving: !reduced });
  if (!seen) { seen = 1; canvas.style.opacity = 1; }
}
requestAnimationFrame(frame);

// Text is on screen first. The field arrives after it, in small steps, so the page never stalls.
const idle = (f) => (window.requestIdleCallback ? requestIdleCallback(f, { timeout: 400 }) : setTimeout(f, 60));
const pause = () => new Promise((r) => idle(r));
async function boot() {
  try {
    const bin = async (f) => new Uint8Array(await (await fetch(`/data/${f}.bin`)).arrayBuffer());
    const [fieldBin, earth, mark] = await Promise.all([bin("field"), bin("earth"), bin("mark")]);
    const max = fieldBin.length / 3, count = innerWidth < 900 ? Math.min(max, 70000) : max;
    const s = makeShapes({ field: fieldBin, earth, mark, count }); await pause();
    const mk = () => new Float32Array(count * 4), targets = [];
    const add = (data, warm = 0) => targets.push({ data, warm });
    const g = mk(); s.galaxy(g); add(g, 0.9); await pause();
    const q = mk(); s.select(q, g, 1); add(q, 0.1); await pause();
    const y = mk(); const yd = s.years(y); add(y); await pause();
    const m = +document.querySelector("[data-year-max]").dataset.yearMax; geo.years = { ...yd, m };
    const gt = mk(); s.gates(gt); add(gt); await pause();
    const mx = mk(); geo.matrix = s.matrix(mx, rows, cols); add(mx); await pause();
    const r = mk(); s.ring(r); add(r); await pause();
    const gb = mk(); s.globe(gb); add(gb); await pause();
    const l = mk(); s.logo(l); add(l); await pause();
    field = createField(canvas, { count, seeds: s.seedA, targets, sizeScale: count < max ? 1.25 : 1 });
    if (count < max && cap) cap.textContent = `Each light is a real paper on AI in education: ${count.toLocaleString("en-US")} of the ${max.toLocaleString("en-US")} on this screen. The oldest sit at the centre, this year's at the rim.`;
    if (!field) canvas.remove();
  } catch (e) { console.error("Field:", e); canvas.remove(); }
}
idle(boot);
