// Turns the Codex scenes into page images. Product screens are captured separately and cropped by art/screens.mjs.
import { existsSync } from "node:fs";
import sharp from "sharp";
const dir = new URL("generated/", import.meta.url).pathname, out = new URL("../public/img/", import.meta.url).pathname;
for (const name of ["telescope", "prism", "spectrograph", "array", "plates", "horizon", "console"]) {
  const src = `${dir}${name}.png`;
  if (!existsSync(src)) { console.log("missing", name); continue; }
  const i = await sharp(src).avif({ quality: 78, effort: 6 }).toFile(`${out}scene-${name}-1672.avif`);
  console.log(name, i.width, i.height, Math.round(i.size / 1024) + " KB");
}
