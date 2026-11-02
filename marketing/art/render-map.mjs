// Plate 01: every paper on AI in education at its real place in the citation map. Data: new-el public/evidence-data/aied.
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import sharp from "sharp";
import { plate, haze, develop, save } from "./lib.mjs";

const here = (f) => new URL(f, import.meta.url).pathname;
const meta = JSON.parse(readFileSync(here("data/meta.json")));
const places = JSON.parse(readFileSync(here("data/places.json")));
const chains = JSON.parse(readFileSync(here("data/chains.json")));
const raw = gunzipSync(readFileSync(here("data/points.bin.gz")));
const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
const col = (T, { offset, length }) => new T(buffer, offset, length);
const l = meta.layout, xy = col(Uint16Array, l.x_y), cites = col(Uint16Array, l.cites), verdict = col(Uint8Array, l.verdict);
const count = meta.points, Q = meta.quant;

function draw(w, h, scale, cx, cy, { bundles = true, dim = 1 } = {}) {
  const p = plate(w, h);
  const X = (x) => cx + (x - meta.space / 2) * scale, Y = (y) => cy + (y - meta.space / 2) * scale;
  if (bundles) for (const [a, b, n] of meta.bundles) {
    const A = places.find((q) => q.level === 1 && q.id === a), B = places.find((q) => q.level === 1 && q.id === b);
    if (!A || !B) continue;
    const [x1, y1, x2, y2] = [X(A.x), Y(A.y), X(B.x), Y(B.y)], mx = (x1 + x2) / 2, my = (y1 + y2) / 2, bend = 0.18;
    const qx = mx + (cy - my) * bend, qy = my + (mx - cx) * bend, v = 0.012 + Math.log1p(n) * 0.0035, N = Math.ceil(Math.hypot(x2 - x1, y2 - y1));
    for (let k = 0; k <= N; k++) { const t = k / N, u = 1 - t; p.stamp(u * u * x1 + 2 * u * t * qx + t * t * x2, u * u * y1 + 2 * u * t * qy + t * t * y2, v); }
  }
  const r = Math.max(1, scale * 2.2);
  for (let i = 0; i < count; i++) {
    const x = X(xy[i * 2] / Q), y = Y(xy[i * 2 + 1] / Q), c = cites[i];
    p.stamp(x, y, (0.16 + Math.log1p(c) * 0.11) * dim);
    if (c >= 40) p.star(x, y, Math.log1p(c) * 0.16 * dim, r * (1 + Math.log10(c) * 0.5));
  }
  return { p, X, Y };
}

// Hero: wide, the map on the right, the left left black for the headline.
{
  const w = 3200, h = 1800, scale = 0.455, cx = w * 0.735, cy = h * 0.53;
  const { p, X, Y } = draw(w, h, scale, cx, cy);
  haze(p, 9, 0.5);
  await save(develop(p, 3.4), "citation-map", [2880, 1600]);
  const labels = places.filter((q) => q.level === 1).map((q) => ({ name: q.name, size: q.size, x: +(X(q.x) / w * 100).toFixed(2), y: +(Y(q.y) / h * 100).toFixed(2) }));
  writeFileSync(here("../src/data/map-labels.json"), JSON.stringify(labels, null, 1));
}
// Phone: the same map, square.
{
  const w = 1200, h = 1200, scale = 0.292;
  const { p } = draw(w, h, scale, w / 2, h / 2);
  haze(p, 5, 0.3);
  await save(develop(p, 2.9), "citation-map-square", [1200, 800]);
}
// Plate: the reviews checked, by verdict, over the dimmed map.
{
  const w = 2400, h = 2000, scale = 0.46, cx = w / 2, cy = h / 2;
  const { p, X, Y } = draw(w, h, scale, cx, cy, { dim: 0.34, bundles: false });
  const marks = Buffer.alloc(w * h * 3);
  const hue = { 7: [229, 72, 77], 6: [240, 150, 60], 5: [240, 200, 90], 4: [76, 195, 138], 3: [76, 195, 138] };
  const paint = (x, y, c, R) => { for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const d = Math.hypot(dx, dy) / R; if (d > 1) continue; const a = Math.min(1, (1 - d) * 3), i = (Math.round(y + dy) * w + Math.round(x + dx)) * 3; if (i < 0 || i >= marks.length) continue; for (let k = 0; k < 3; k++) marks[i + k] = Math.max(marks[i + k], c[k] * a); } };
  const tally = {};
  for (const c of chains) { tally[c.verdict] = (tally[c.verdict] ?? 0) + 1; const i = c.index; if (i == null || !hue[c.verdict]) continue; paint(X(xy[i * 2] / Q), Y(xy[i * 2 + 1] / Q), hue[c.verdict], 11); }
    haze(p, 7, 0.25);
  await save(develop(p, 2.7, marks), "evidence-chains", [2000, 1000]);
  writeFileSync(here("../src/data/verdicts.json"), JSON.stringify(tally));
  console.log("verdicts", tally);
}
