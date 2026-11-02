// A radial chart of OpenAlex's real taxonomy: domains, fields, subfields, each leaf as long as its works.
import { writeFileSync } from "node:fs";
const UA = { "User-Agent": "openscholar-site-build (contact@opendeved.net)" };
async function all(kind) {
  const rows = [];
  for (let page = 1; ; page++) {
    const r = await (await fetch(`https://api.openalex.org/${kind}?per-page=200&page=${page}`, { headers: UA })).json();
    rows.push(...r.results);
    if (rows.length >= r.meta.count) return rows;
  }
}
const [fields, subfields] = await Promise.all([all("fields"), all("subfields")]);
const fieldId = (s) => s.split("/").pop();
const order = [...fields].sort((a, b) => a.domain.display_name.localeCompare(b.domain.display_name) || a.display_name.localeCompare(b.display_name));
const S = 1200, c = S / 2, R0 = 118, R1 = 300, R2 = 348, RL = 530;
const pt = (a, r) => [+(c + r * Math.cos(a)).toFixed(1), +(c + r * Math.sin(a)).toFixed(1)];
const maxLog = Math.log10(Math.max(...subfields.map((s) => s.works_count)));
const gap = 0.018, N = subfields.length, unit = (2 * Math.PI - gap * order.length) / N;
let a = -Math.PI / 2, groups = "", extra = "";
const domains = {};
for (const f of order) {
  const subs = subfields.filter((s) => fieldId(s.field.id) === fieldId(f.id)).sort((x, y) => y.works_count - x.works_count);
  const start = a, mid = a + (subs.length * unit) / 2;
  const [fx, fy] = pt(mid, R1), [hx, hy] = pt(mid, R0);
  (domains[f.domain.display_name] ??= []).push(mid);
  let links = `M${hx} ${hy}Q${pt(mid, (R0 + R1) / 2).join(" ")} ${fx} ${fy}`, leaves = "";
  const total = subs.reduce((n, x) => n + x.works_count, 0);
  for (const s of subs) {
    const m = a + unit / 2, len = 18 + (Math.log10(Math.max(10, s.works_count)) / maxLog) ** 3 * 150;
    const [x0, y0] = pt(m, R2), [x1, y1] = pt(m, R2 + len);
    links += `M${fx} ${fy}L${x0} ${y0}`;
    leaves += `M${x0} ${y0}L${x1} ${y1}`;
    a += unit;
  }
  const mid2 = (start + a) / 2, deg = mid2 * 180 / Math.PI, flip = Math.cos(mid2) < 0;
  const [lx, ly] = pt(mid2, RL);
  const name = f.display_name.replace("&", "&amp;");
  groups += `<g class="f" tabindex="0" data-name="${name}" data-subs="${subs.length}" data-works="${total}" data-top="${subs.slice(0, 3).map((x) => x.display_name.replace("&", "&amp;")).join(", ")}"><path class="ln" d="${links}"/><path class="lf" d="${leaves}"/><circle cx="${fx}" cy="${fy}" r="3"/><text transform="translate(${lx} ${ly}) rotate(${(flip ? deg + 180 : deg).toFixed(1)})" text-anchor="${flip ? "end" : "start"}" dominant-baseline="middle">${name}</text></g>`;
  a += gap;
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-290 -290 ${S + 580} ${S + 580}" role="img" aria-label="OpenAlex's ${fields.length} research fields and ${N} subfields, as a radial chart">${groups}</svg>`;
writeFileSync(new URL("../src/data/topics.svg", import.meta.url), svg);
console.log({ fields: fields.length, subfields: N, kb: Math.round(svg.length / 1024) });
