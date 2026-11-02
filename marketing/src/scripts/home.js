import { createField, readPapers, mat3Tilt, mulberry, I3 } from "./field.js";

// One journey of light. Every shape is drawn in the coordinates of the photograph it lines up with, so the beam really enters the telescope, splits at the prism and lands on the plate.
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (t) => t * t * (3 - 2 * t);
const IMG = 1672 / 941, TAU = Math.PI * 2;
const uv = (u, v) => [(u - 0.5) * 2 * IMG, (0.5 - v) * 2];
const gauss = (r) => Math.sqrt(-2 * Math.log(Math.max(1e-6, r()))) * Math.cos(TAU * r());

function shapes(count, seed, bright) {
  const stars = (o, i, r, level = 0.07) => { o[i * 4] = (r() - 0.5) * 6; o[i * 4 + 1] = (r() - 0.5) * 3.4; o[i * 4 + 2] = -r() * 0.6; o[i * 4 + 3] = level * (0.5 + bright(i) * 0.7); };
  const line = (o, i, r, A, B, t, w, level) => { const dx = B[0] - A[0], dy = B[1] - A[1], l = Math.hypot(dx, dy) || 1, n = gauss(r) * w; o[i * 4] = A[0] + dx * t - dy / l * n; o[i * 4 + 1] = A[1] + dy * t + dx / l * n; o[i * 4 + 2] = gauss(r) * Math.abs(w) * 0.6; o[i * 4 + 3] = level; };
  return {
    // Starlight pours through the dome into the telescope's mirror.
    telescope(o) { const r = mulberry(21), A = uv(0.34, -0.3), B = uv(0.672, 0.445); for (let i = 0; i < count; i++) { const h = seed[i * 2]; if (h < 0.6) { const t = Math.pow(r(), 0.75); line(o, i, r, A, B, t, 0.2 * (1 - t) + 0.008, (0.16 + bright(i) * 0.4) * (0.5 + t)); } else stars(o, i, r); } },
    // A thin beam enters the prism and fans into colour. One line carries on through the slit, and the rest fall away.
    prism(o) { const r = mulberry(22), P = uv(0.565, 0.505), F = uv(0.69, 0.505), X = uv(0.8125, 0.505), E = uv(1.2, 0.505), S = uv(-0.2, 0.505); for (let i = 0; i < count; i++) { const h = seed[i * 2];
      if (h < 0.3) line(o, i, r, S, P, r(), 0.004, 0.3 + bright(i) * 0.3);
      else if (h < 0.34) line(o, i, r, P, F, r(), 0.012, 0.3);
      else if (h < 0.58) { const t = r(), hue = seed[i * 2]; o[i * 4] = F[0] + (X[0] - F[0]) * t; o[i * 4 + 1] = F[1] + ((h - 0.34) / 0.24 - 0.5) * 0.17 * t; o[i * 4 + 2] = 0; o[i * 4 + 3] = -0.55; }
      else if (h < 0.63) line(o, i, r, X, E, r(), 0.0035, 0.75);
      else if (h < 0.86) { const f = Math.pow(r(), 1.3); o[i * 4] = X[0] - 0.03 + gauss(r) * (0.025 + f * 0.1); o[i * 4 + 1] = X[1] - f * 1.05; o[i * 4 + 2] = gauss(r) * 0.05; o[i * 4 + 3] = (0.32 + bright(i) * 0.3) * (1 - f * 0.85); }
      else stars(o, i, r); } },
    // The spectrum settles along the glass.
    spectrum(o) { const r = mulberry(23), A = uv(0.405, 0.82), B = uv(0.93, 0.19); for (let i = 0; i < count; i++) { const h = seed[i * 2]; if (h < 0.55) { const t = r(), bars = 0.5 + 0.5 * Math.sin(t * 190 + Math.sin(t * 37) * 6); line(o, i, r, A, B, t, 0.012, (0.1 + bars * 0.5) * (0.6 + bright(i) * 0.4)); } else if (h < 0.62) { const t = r(); line(o, i, r, A, B, t, 0.11, 0.08); } else stars(o, i, r); } },
    // The dial, with work orbiting it.
    console(o) { const r = mulberry(24), C = uv(0.806, 0.4); for (let i = 0; i < count; i++) { const h = seed[i * 2]; if (h < 0.42) { const a = r() * TAU, R = 0.22 + gauss(r) * 0.012 + (h < 0.14 ? 0.1 : 0); o[i * 4] = C[0] + Math.cos(a) * R * 1.25; o[i * 4 + 1] = C[1] + Math.sin(a) * R * 0.74; o[i * 4 + 2] = Math.sin(a) * R * 0.5; o[i * 4 + 3] = 0.16 + bright(i) * 0.5; } else stars(o, i, r); } },
    // Every dish on one patch of sky.
    array(o) { const r = mulberry(25), T = uv(0.5, 0.1), D = [0.106, 0.225, 0.344, 0.456, 0.569, 0.681, 0.8, 0.913]; for (let i = 0; i < count; i++) { const h = seed[i * 2]; if (h < 0.16) { const d = uv(D[Math.floor(r() * 8)], 0.6), t = r(); line(o, i, r, d, T, t, 0.003, 0.16 * (0.4 + t)); } else if (h < 0.34) { o[i * 4] = T[0] + gauss(r) * 0.09; o[i * 4 + 1] = T[1] + gauss(r) * 0.06; o[i * 4 + 2] = 0; o[i * 4 + 3] = 0.2 + bright(i) * 0.7; } else { o[i * 4] = (r() - 0.5) * 5.6; o[i * 4 + 1] = r() * 1.5 - 0.02; o[i * 4 + 2] = -r() * 0.4; o[i * 4 + 3] = 0.06 + bright(i) * 0.28; } } },
    // The light lands on the glass plate.
    plate(o) { const r = mulberry(26), TL = uv(0.69, 0.32), TR = uv(0.906, 0.31), BL = uv(0.68, 0.62), BR = uv(0.9, 0.6), S = uv(0.12, -0.2); for (let i = 0; i < count; i++) { const h = seed[i * 2]; if (h < 0.34) { const a = r(), b = r(), e = [TL[0] + (TR[0] - TL[0]) * a + (BL[0] - TL[0]) * b, TL[1] + (TR[1] - TL[1]) * a + (BL[1] - TL[1]) * b]; const t = Math.pow(r(), 0.55); line(o, i, r, S, e, t, 0.06 * (1 - t) + 0.002, 0.1 + bright(i) * 0.25); } else stars(o, i, r); } },
    // Everything settles along the edge of a world.
    horizon(o) { const r = mulberry(27), R = 5.77, C = uv(0.5, 0.622), cy = C[1] - R; for (let i = 0; i < count; i++) { const h = seed[i * 2]; if (h < 0.5) { const x = (r() - 0.5) * 3.6, y = cy + Math.sqrt(R * R - x * x) + Math.abs(gauss(r)) * 0.012; o[i * 4] = x; o[i * 4 + 1] = y; o[i * 4 + 2] = 0; o[i * 4 + 3] = (0.1 + bright(i) * 0.3) * Math.max(0.05, 1 - Math.abs(x) / 1.75); } else { o[i * 4] = (r() - 0.5) * 6; o[i * 4 + 1] = C[1] + r() * 1.6; o[i * 4 + 2] = -r() * 0.5; o[i * 4 + 3] = 0.05 + bright(i) * 0.3; } } },
  };
}

// Chapters, in the order of the page. `t` is the shape, `f` the point of the photo to keep in view on a narrow screen.
const CH = [{ t: 0 }, { t: 0 }, { t: 1, f: 0.67 }, { t: 2, f: 0.68 }, { t: 3, f: 0.66 }, { t: 4, f: 0.8 }, { t: 5, f: 0.5 }, { t: 6, f: 0.79 }, { t: 7, f: 0.5 }];
const sections = [...document.querySelectorAll("[data-ch]")], copies = sections.map((s) => s.querySelector("[data-copy]")), photos = CH.map((_, i) => document.querySelector(`[data-photo="${i}"]`));
const canvas = document.querySelector("[data-field]"), said = document.querySelector("[data-said]"), words = [...said.querySelectorAll("span")], steps = [...document.querySelectorAll("[data-step]")];
let tops = [], sayTop = 0, sayH = 0, vw = 0, vh = 0, scale = 1, narrow = false;
function measure() {
  const y = scrollY; vw = innerWidth; vh = innerHeight; const asp = vw / vh; narrow = vw < 900; scale = Math.max(1, asp / IMG);
  tops = sections.map((s) => s.getBoundingClientRect().top + y); const r = said.closest("section").getBoundingClientRect(); sayTop = r.top + y; sayH = r.height;
  // On a narrow screen, slide each photo so its subject stays in view, and move the camera with it.
  photos.forEach((p, i) => { if (!p) return; const over = 2 * IMG - 2 * asp; if (over <= 0) { p.style.objectPosition = "50% 50%"; CH[i].pan = 0; return; } const wanted = (CH[i].f - 0.5) * 2 * IMG, k = clamp(wanted / over + 0.5); p.style.objectPosition = `${(k * 100).toFixed(2)}% 50%`; CH[i].pan = (k - 0.5) * over; });
}
measure(); addEventListener("resize", measure, { passive: true });
const chapterAt = (y) => { for (let i = sections.length - 1; i >= 1; i--) { const start = tops[i] - vh * 0.85, end = tops[i] - vh * 0.1; if (y >= start) return i - 1 + clamp((y - start) / (end - start)); } return 0; };

let field = null, cur = 0, then = 0, shown = false, pull = 0, pulling = 0, active = -1;
document.querySelectorAll("[data-ask-input]").forEach((a) => { a.addEventListener("focus", () => { pulling = 1; }); a.addEventListener("blur", () => { pulling = 0; }); });

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
  if (moving || now !== active) {
    copies.forEach((c, i) => { const near = Math.abs(cur - i); if (near > 1.2) { if (c.style.visibility !== "hidden") { c.style.visibility = "hidden"; c.style.opacity = 0; } return; } const al = i === 0 ? clamp(1 - cur * 2.4) : clamp(1.25 - near * 2.6); c.style.visibility = al > 0.01 ? "visible" : "hidden"; c.style.opacity = al; c.style.transform = `translate3d(0, ${(i - cur) * 70}px, 0)`; });
    photos.forEach((p, i) => { if (!p) return; const al = clamp(1.3 - Math.abs(cur - i) * 1.9); p.style.opacity = al; p.style.visibility = al > 0.01 ? "visible" : "hidden"; });
    const sp = clamp((y - sayTop) / (sayH - vh || 1)), lit = sp * 1.2 * words.length; if (y > sayTop - vh && y < sayTop + sayH) words.forEach((w, i) => { w.style.opacity = 0.14 + 0.86 * clamp(lit - i); });
    const st = clamp((cur - 4.75) / 0.5); steps.forEach((el, i) => el.toggleAttribute("data-done", st > (i + 0.3) / steps.length));
    active = now;
  }
  if (!field) return;
  pull += (pulling - pull) * (1 - Math.exp(-dt * 3));
  const TA = CH[a].t, TB = CH[b].t, fly = smooth(clamp((y - tops[1] + vh * 0.5) / (sayH - vh * 0.2))), tm = reduced ? 0 : t, tilt = mat3Tilt(1.0 - fly * 0.45, tm * 0.016);
  const hx = narrow ? 0 : -0.62, hy = narrow ? -0.2 : -0.28, hz = (narrow ? 4.9 : 3.0) - Math.pow(fly, 1.6) * (narrow ? 4.3 : 2.5);
  const camOf = (i) => (i <= 1 ? [hx * (1 - fly), hy * (1 - fly), hz] : [CH[i].pan ?? 0, 0, 2.66]);
  const A = camOf(a), B = camOf(b), ex = A[0] + (B[0] - A[0]) * e, ey = A[1] + (B[1] - A[1]) * e, ez = A[2] + (B[2] - A[2]) * e;
  const rot = (s) => (s === 0 ? tilt : I3), same = TA === TB;
  field.render({ a: TA, b: TB, mix: same ? 0 : m, time: tm, eye: [ex, ey, ez], center: [ex, ey, 0], rotA: rot(TA), rotB: rot(TB), swirl: 0.3, moving: !reduced && !same, scaleA: TA === 0 ? 1 : scale, scaleB: TB === 0 ? 1 : scale, pull });
  if (!shown) { shown = true; canvas.style.opacity = 1; }
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
    const S = shapes(count, p.seedA, p.bright), mk = (f) => { const d = new Float32Array(count * 4); f(d); return d; };
    const targets = [{ data: mk(p.galaxy), warm: 0.9 }]; await pause();
    for (const [f, wave, dir] of [[S.telescope, 0.5, [0.45, -0.9]], [S.prism, 0.55, [1, 0]], [S.spectrum, 0.22, [0.64, 0.77]], [S.console, 0.3, [0.5, 0.5]], [S.array, 0.35, [0, 1]], [S.plate, 0.4, [0.7, -0.7]], [S.horizon, 0.3, [1, 0]]]) { targets.push({ data: mk(f), wave, dir }); await pause(); }
    field = createField(canvas, { count, seeds: p.seedA, targets, sizeScale: count < max ? 1.25 : 1 });
    if (!field) canvas.remove();
  } catch (e) { console.error("Field:", e); canvas.remove(); }
});
