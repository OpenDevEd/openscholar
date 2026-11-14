// The team's portraits for the About pages. Each public photo has its person lifted off the background first (macOS Vision's
// foreground mask, with the largest face's box written to faces.json), so ten photos taken in ten rooms sit together as one set.
// Usage: node art/team.mjs <folder with <key>.png cutouts and faces.json>
// Writes public/img/team/<key>.avif, a 4 by 5 frame with the face the same size and place in every one, and <key>-face.avif.
import sharp from "sharp"; import { readFileSync } from "node:fs";
const from = process.argv[2], out = new URL("../public/img/team/", import.meta.url).pathname, faces = JSON.parse(readFileSync(`${from}/faces.json`, "utf8"));
// The face is 38% of the frame's height and sits 40% down it. A photo cropped tighter than that fills the frame's width, and
// one whose head touches its top edge starts at the frame's top, so no cut edge of a photo ever shows inside the frame. Tall
// hair or a headwrap moves the frame up until it clears the top of the head.
const FACE = .38, EYE = .4;
for (const [key, f] of Object.entries(faces)) {
  const { data: alpha, info } = await sharp(`${from}/${key}.png`).extractChannel("alpha").raw().toBuffer({ resolveWithObject: true });
  const crown = Math.floor(alpha.findIndex((v) => v > 60) / info.width);
  const H = Math.min(f.fh / FACE, f.w / .8), W = H * .8, left = Math.round(Math.min(Math.max(f.fx - W / 2, 0), f.w - W)), top = Math.round(Math.max(Math.min(f.fy - EYE * H, crown - .03 * H), 0)), w = Math.round(W), h = Math.round(Math.min(H, f.h - top));
  const cut = await sharp(`${from}/${key}.png`).extract({ left, top, width: Math.min(w, f.w - left), height: h }).extend({ bottom: Math.round(H) - h, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const a = await sharp(cut).resize(480, 600, { fit: "fill" }).avif({ quality: 58, effort: 7 }).toFile(`${out}${key}.avif`);
  const side = Math.round(Math.min(f.fh * 1.7, f.w, f.h)), fl = Math.round(Math.min(Math.max(f.fx - side / 2, 0), f.w - side)), ft = Math.round(Math.min(Math.max(f.fy - side * .54, 0), f.h - side));
  const b = await sharp(`${from}/${key}.png`).extract({ left: fl, top: ft, width: side, height: side }).resize(160, 160).avif({ quality: 58, effort: 7 }).toFile(`${out}${key}-face.avif`);
  console.log(key, Math.round(a.size / 1024), "KB,", Math.round(b.size / 1024), "KB, shown down to", Math.round(((f.h - top) / H) * 100) + "%");
}
