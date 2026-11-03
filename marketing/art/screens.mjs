// Compresses captured screens into the sizes each device shows them at. Usage: node art/screens.mjs <folder of name-device-theme.png>
// Laptop screens are captured at 1280 by 800, tablets at 834 by 1112 and phones at 393 by 852, signed in to a test workspace, in both themes.
import sharp from "sharp"; import { readdirSync, mkdirSync } from "node:fs";
const from = process.argv[2], out = new URL("../public/img/screens/", import.meta.url).pathname; mkdirSync(out, { recursive: true });
const WIDTHS = { laptop: [2000, 1000], tablet: [1400, 800], phone: [800, 400] }; let total = 0;
for (const f of readdirSync(from).filter((x) => x.endsWith(".png"))) { const name = f.slice(0, -4), dev = name.split("-").at(-2); for (const [i, w] of WIDTHS[dev].entries()) { const r = await sharp(`${from}/${f}`).resize({ width: w }).avif({ quality: i ? 48 : 56, effort: 6 }).toFile(`${out}${name}${i ? `-${w}` : ""}.avif`); total += r.size; } }
console.log("total KB", Math.round(total / 1024));
