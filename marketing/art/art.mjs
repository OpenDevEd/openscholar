// Compresses generated art into page images, full size and phone size. Usage: node art/art.mjs <folder with the pngs named after art-prompts.txt>
import sharp from "sharp"; import { readdirSync } from "node:fs";
const from = process.argv[2], out = new URL("../public/img/", import.meta.url).pathname;
for (const name of readdirSync(from).filter((f) => f.endsWith(".png") && !/^(role|stack)/.test(f)).map((f) => f.slice(0, -4))) for (const [w, tail, quality] of [[1672, "", 52], [960, "-960", 46], [480, "-480", 46]]) { const i = await sharp(`${from}/${name}.png`).resize({ width: w }).avif({ quality, effort: 7 }).toFile(`${out}art-${name}${tail}.avif`); console.log(name, w, Math.round(i.size / 1024), "KB"); }
// Role emblems keep their transparency. Usage: node art/art.mjs <folder> also reads role-*.png from it, at 240 square.
for (const f of readdirSync(from).filter((x) => x.startsWith("role-"))) await sharp(`${from}/${f}`).resize(240, 240, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).avif({ quality: 62, effort: 7 }).toFile(`${out}${f.slice(0, -4)}.avif`);
// The glass stack is one tall column whose hair-thin sheet edges need more quality than the page setting, so it keeps its own size and has one file.
for (const f of readdirSync(from).filter((x) => x.startsWith("stack"))) await sharp(`${from}/${f}`).avif({ quality: 68, effort: 7 }).toFile(`${out}art-${f.slice(0, -4)}.avif`);
