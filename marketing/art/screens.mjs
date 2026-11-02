// Crops the captured product screens (3000 by 1880) into page images. Usage: node art/screens.mjs <folder of s-*.png>
import sharp from "sharp";
const from = process.argv[2], out = new URL("../public/img/", import.meta.url).pathname;
const CROPS = { overview: ["results", 846, 696, 2109, 1184], rows: ["screening2", 1010, 330, 1640, 1460] };
for (const [name, [file, left, top, width, height]] of Object.entries(CROPS)) {
  const i = await sharp(`${from}/s-${file}.png`).extract({ left, top, width, height }).resize({ width: 1600 }).avif({ quality: 62, effort: 6 }).toFile(`${out}app-${name}.avif`);
  console.log(name, i.width, i.height, Math.round(i.size / 1024) + " KB");
}
