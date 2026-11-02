// Crops captured library pages into page images. Usage: node art/libraries.mjs <folder with wi-*.png>
import sharp from "sharp";
const from = process.argv[2], out = new URL("../public/img/", import.meta.url).pathname;
const CROPS = { "lib-plate": ["wi-light", 0, 0, 1650, 1290, 1000], "lib-home": ["wi-dark", 216, 0, 1520, 950, 1920], "lib-fan-dark": ["wi-dark", 1110, 100, 620, 660, 720], "lib-fan-light": ["wi-light", 280, 110, 1180, 420, 1000] };
for (const [name, [file, left, top, width, height, w]] of Object.entries(CROPS)) { const i = await sharp(`${from}/${file}.png`).extract({ left, top, width, height }).resize({ width: w }).avif({ quality: 60, effort: 6 }).toFile(`${out}${name}.avif`); console.log(name, i.width, i.height, Math.round(i.size / 1024) + " KB"); }
