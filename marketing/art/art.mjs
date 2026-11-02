// Compresses generated art into page images, full size and phone size. Usage: node art/art.mjs <folder with the pngs named after art-prompts.txt>
import sharp from "sharp";
const from = process.argv[2], out = new URL("../public/img/", import.meta.url).pathname;
for (const name of ["hero-ribbon", "dark-ribbon", "sieve", "grid", "thread", "globe", "converge", "sea", "gate"]) for (const [w, tail, quality] of [[1672, "", 52], [960, "-960", 46]]) { const i = await sharp(`${from}/${name}.png`).resize({ width: w }).avif({ quality, effort: 7 }).toFile(`${out}art-${name}${tail}.avif`); console.log(name, w, Math.round(i.size / 1024), "KB"); }
