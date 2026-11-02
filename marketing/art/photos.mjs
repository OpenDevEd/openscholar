// Turns Codex's scene PNGs into page images. Run again whenever a scene changes.
import { existsSync } from "node:fs";
import sharp from "sharp";
const dir = new URL("generated/", import.meta.url).pathname, out = new URL("../public/img/", import.meta.url).pathname;
for (const name of ["array", "plates"]) {
  const src = `${dir}${name}.png`;
  if (!existsSync(src)) { console.log("missing", name); continue; }
  for (const width of [1672]) {
    const i = await sharp(src).resize({ width }).avif({ quality: 66, effort: 6 }).toFile(`${out}scene-${name}-${width}.avif`);
    console.log(name, width, i.width, i.height, Math.round(i.size / 1024) + " KB");
  }
}
