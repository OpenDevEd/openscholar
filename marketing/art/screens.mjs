// Compresses captured screens into the sizes each device shows them at. Usage: node art/screens.mjs <folder of name-device-theme.png>
// Laptops are captured at 1120 by 700, community laptops at 1440 by 900, tablets at 834 by 1112 and phones at 393 by 795, signed in to a test workspace, in both themes.
// A phone's capture gets a band on top in the colour of its own header, for the status bar to sit on, so the two read as one screen.
import sharp from "sharp"; import { readdirSync, mkdirSync } from "node:fs";
const from = process.argv[2], out = new URL("../public/img/screens/", import.meta.url).pathname; mkdirSync(out, { recursive: true });
const WIDTHS = { laptop: [2000, 1000], tablet: [1400, 800], phone: [800, 400] }; let total = 0;
const save = async (img, name, w, q) => { const r = await img.resize({ width: w }).avif({ quality: q, effort: 6 }).toFile(`${out}${name}.avif`); total += r.size; };
for (const f of readdirSync(from).filter((x) => x.endsWith(".png") && !x.startsWith("approve") && !x.startsWith("trust"))) {
  const name = f.slice(0, -4), dev = name.split("-").at(-2), file = `${from}/${f}`, m = await sharp(file).metadata();
  let base = await sharp(file).png().toBuffer();
  if (dev === "phone") { const { data } = await sharp(file).extract({ left: m.width >> 1, top: 2, width: 1, height: 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true }); base = await sharp(file).removeAlpha().extend({ top: Math.round(m.height * (57 / 795)), background: { r: data[0], g: data[1], b: data[2] } }).png().toBuffer(); }
  for (const [i, w] of WIDTHS[dev].entries()) await save(sharp(base), `${name}${i ? `-${w}` : ""}`, w, i ? 48 : 56);
}
// Panels shown at their real size, cut from the laptop captures: [name, file, left, top, width, height]
for (const [name, file, left, top, width, height] of [["panel-citation-light", "trust-laptop-light", 176, 18, 890, 1364]]) await save(sharp(`${from}/${file}.png`).extract({ left, top, width, height }), name, width, 62);
for (const n of ["c-search-laptop-light", "c-map-laptop-light", "c-home2-laptop-light", "c-home-laptop-light", "c-search-laptop-dark"]) await save(sharp(`${from}/${n}.png`), `${n}-240`, 240, 52);
console.log("total KB", Math.round(total / 1024));
