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
let a = -Math.PI / 2, links = "", leaves = "", labels = "", hubs = "";
const domains = {};
for (const f of order) {
  const subs = subfields.filter((s) => fieldId(s.field.id) === fieldId(f.id)).sort((x, y) => y.works_count - x.works_count);
  const start = a, mid = a + (subs.length * unit) / 2;
  const [fx, fy] = pt(mid, R1), [hx, hy] = pt(mid, R0);
  (domains[f.domain.display_name] ??= []).push(mid);
  links += `M${hx} ${hy}Q${pt(mid, (R0 + R1) / 2).join(" ")} ${fx} ${fy}`;
  hubs += `<circle cx="${fx}" cy="${fy}" r="3"/>`;
  for (const s of subs) {
    const m = a + unit / 2, len = 18 + (Math.log10(Math.max(10, s.works_count)) / maxLog) ** 3 * 150;
    const [x0, y0] = pt(m, R2), [x1, y1] = pt(m, R2 + len);
    links += `M${fx} ${fy}L${x0} ${y0}`;
    leaves += `M${x0} ${y0}L${x1} ${y1}`;
    a += unit;
  }
  const mid2 = (start + a) / 2, deg = mid2 * 180 / Math.PI, flip = Math.cos(mid2) < 0;
  const [lx, ly] = pt(mid2, RL);
  labels += `<text transform="translate(${lx} ${ly}) rotate(${(flip ? deg + 180 : deg).toFixed(1)})" text-anchor="${flip ? "end" : "start"}" dominant-baseline="middle">${f.display_name.replace("&", "&amp;")}</text>`;
  a += gap;
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-290 -290 ${S + 580} ${S + 580}" role="img" aria-label="OpenAlex's ${fields.length} research fields and ${N} subfields, drawn as a radial chart">
<path d="${links}" fill="none" stroke="#2563eb" stroke-width=".8" opacity=".55"/><path d="${leaves}" fill="none" stroke="#bfdbfe" stroke-width="2.4"/><g fill="#bfdbfe">${hubs}</g><circle cx="${c}" cy="${c}" r="${R0}" fill="none" stroke="#333" stroke-width=".7"/><g font-family="Ubuntu,system-ui,sans-serif" font-size="22" fill="#d4d4d4">${labels}</g></svg>`;
writeFileSync(new URL("../public/img/topics.svg", import.meta.url), svg);
console.log({ fields: fields.length, subfields: N, kb: Math.round(svg.length / 1024) });
