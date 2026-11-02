// Packs the real data the particle field is made of. Papers: AIED's citation map. Earth: 9,988 institutions plus land. Mark: the logo.
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import sharp from "sharp";
const here = (f) => new URL(f, import.meta.url).pathname;
const meta = JSON.parse(readFileSync(here("data/meta.json")));
const raw = gunzipSync(readFileSync(here("data/points.bin.gz"))), buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
const col = (T, { offset, length }) => new T(buffer, offset, length);
const years = col(Uint16Array, meta.layout.year), cites = col(Uint16Array, meta.layout.cites), region = col(Uint16Array, meta.layout.region);
const n = meta.points, order = Array.from({ length: n }, (_, i) => i);
let seed = 42; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
const out = new Uint8Array(n * 3), hist = {};
order.forEach((p, k) => {
  const y = years[p] || 0;
  out[k * 3] = region[p] > 9 ? 10 : region[p];
  out[k * 3 + 1] = y < 1950 ? 0 : Math.min(255, y - 1949);
  out[k * 3 + 2] = Math.min(255, Math.round(Math.log1p(cites[p]) * 32));
  if (y >= 2008) hist[y] = (hist[y] ?? 0) + 1; else hist.earlier = (hist.earlier ?? 0) + 1;
});
writeFileSync(here("../public/data/field.bin"), out);

const places = Object.values(JSON.parse(readFileSync(here("data/institutions.json"))));
const svg = readFileSync(here("data/world.svg"), "utf8").replace(/<svg /, '<svg fill="#fff" ');
const W = 1600, H = 800, { data } = await sharp(Buffer.from(svg), { density: 144 }).resize(W, H).flatten({ background: "#000" }).greyscale().raw().toBuffer({ resolveWithObject: true });
const rad = Math.PI / 180;
function equalEarth(lon, lat) { const A = [1.340264, -0.081106, 0.000893, 0.003796], M = Math.sqrt(3) / 2, t = Math.asin(M * Math.sin(lat * rad)), t2 = t * t, t6 = t2 * t2 * t2; return [lon * rad * Math.cos(t) / (M * (A[0] + 3 * A[1] * t2 + t6 * (7 * A[2] + 9 * A[3] * t2))), t * (A[0] + A[1] * t2 + t6 * (A[2] + A[3] * t2))]; }
const land = (lon, lat) => { const [x, y] = equalEarth(lon, lat), px = Math.round((400 + x * 150) * 2), py = Math.round((200 - y * 150) * 2); return px >= 0 && py >= 0 && px < W && py < H && data[py * W + px] > 90; };
const landPts = [];
for (let lat = -58; lat < 84; lat += 0.62) for (let lon = -180; lon < 180; lon += 0.62 / Math.max(0.25, Math.cos(lat * rad))) if (land(lon, lat)) landPts.push(lon, lat);
const earth = new Int16Array(2 + places.length * 2 + landPts.length);
earth[0] = places.length % 32768; earth[1] = landPts.length / 2 % 32768;
places.forEach((q, i) => { earth[2 + i * 2] = Math.round(q[0] * 100); earth[3 + i * 2] = Math.round(q[1] * 100); });
landPts.forEach((v, i) => { earth[2 + places.length * 2 + i] = Math.round(v * 100); });
writeFileSync(here("../public/data/earth.bin"), Buffer.from(earth.buffer));

const mark = readFileSync(here("../../public/icon-black.svg"), "utf8");
const M = 900, img = await sharp(Buffer.from(mark), { density: 900 }).resize(M, M, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).flatten({ background: "#000" }).greyscale().raw().toBuffer();
const pts = []; let tries = 0;
while (pts.length < 16000 * 3 && tries++ < 4e6) { const x = Math.floor(rnd() * M), y = Math.floor(rnd() * M), v = img[y * M + x]; if (v > 40) pts.push(x, y, v); }
writeFileSync(here("../public/data/mark.bin"), Buffer.from(new Uint16Array(pts).buffer));

// Real answers for the extraction page: each one must quote its own abstract.
const abstracts = JSON.parse(readFileSync(here("data/abstracts.json")));
const A = {
  W4365421043: { size: ["298", "298 third and fifth grade pupils"], design: ["Randomised trial", "A randomised trial was conducted"], effect: ["+0.16", "Effect Size +0.16"] },
  W3133736206: { size: ["295", "involving 295"], design: ["Randomised controlled", "A randomised controlled experimental study"], effect: null },
  W3033939527: { size: ["89", "89 students from first"], design: ["Quasi-experimental", "quasi-experimental with pretest"], effect: ["d = 0.78", "Cohen’s d = 0.78"] },
  W3167324738: { size: ["227", "intact classes of 227 students"], design: ["Quasi-experimental", "non-randomized quasi experimental"], effect: null },
  W2577910513: { size: ["78", "A total of 78 participants"], design: ["Randomised control trial", "A Randomised Control Trial was used"], effect: null },
};
const papers = abstracts.map((p) => {
  const sentences = p.abstract.match(/[^.!?]+(?:\.\d+[^.!?]*)*[.!?]+(\s|$)/g).map((s) => s.trim());
  const cell = (c, key) => {
    if (!c) { if (/effect size|cohen|hedges/i.test(p.abstract)) throw new Error(`${p.id} reports an effect size: add it`); return { value: "Not reported", at: -1 }; }
    const at = sentences.findIndex((s) => s.includes(c[1])); if (at < 0) throw new Error(`${p.id} ${key}: "${c[1]}" is not in the abstract`); return { value: c[0], at };
  };
  const a = A[p.id];
  return { id: p.id, title: p.title, year: p.year, sentences, size: cell(a.size, "size"), design: cell(a.design, "design"), effect: cell(a.effect, "effect") };
});
writeFileSync(here("../src/data/extraction.json"), JSON.stringify(papers));

const yearList = Object.entries(hist).filter(([k]) => k !== "earlier").map(([y, c]) => [+y, c]);
writeFileSync(here("../src/data/field-meta.json"), JSON.stringify({ n, earlier: hist.earlier, years: yearList, inst: places.length, land: landPts.length / 2 }));
for (const f of ["field", "earth", "mark"]) { const b = readFileSync(here(`../public/data/${f}.bin`)); console.log(f, Math.round(b.length / 1024) + " KB", "gz", Math.round(gzipSync(b).length / 1024) + " KB"); }
console.log({ earlier: hist.earlier, land: landPts.length / 2, marks: pts.length / 3 }, papers.map((p) => [p.size.value, p.design.value, p.effect.value]));
