// The team's portraits for the About pages. Each public photo has its person lifted off the background first (macOS Vision's
// foreground mask, with the largest face's box written to faces.json), so ten photos taken in ten rooms sit together as one set.
// Usage: node art/team.mjs <folder with <key>.png cutouts and faces.json>
// Writes public/img/team/<key>.avif, a 4 by 5 frame with the face the same size and place in every one, and <key>-face.avif.
import sharp from "sharp"; import { readFileSync } from "node:fs";
const from = process.argv[2], out = new URL("../public/img/team/", import.meta.url).pathname, faces = JSON.parse(readFileSync(`${from}/faces.json`, "utf8"));
// The face is 38% of the frame's height, in the frame's middle, its eye line 40% down. Tall hair or a headwrap moves the frame
// up until it clears the top of the head. A photo cropped tighter than the frame doesn't fill it: the frame is empty past the
// photo's edge, and that edge is faded out so no straight cut shows. Only a head that touches the photo's own top edge keeps
// the frame's top at the photo's, as a cut through hair can't be faded.
const FACE = .38, EYE = .4, OUT = [480, 600];
// A head tilted towards the camera reads larger than its face box says, so it is set a little smaller by hand.
const TUNE = { bjorn: .92 };
const ease = (t) => { t = Math.min(Math.max(t, 0), 1); return t * t * (3 - 2 * t); };
for (const [key, f] of Object.entries(faces)) {
  const { data: alpha, info } = await sharp(`${from}/${key}.png`).extractChannel("alpha").raw().toBuffer({ resolveWithObject: true });
  const crown = Math.floor(alpha.findIndex((v) => v > 60) / info.width);
  const H = f.fh / (FACE * (TUNE[key] ?? 1)), W = H * .8, w = Math.round(W), h = Math.round(H);
  // Where the frame's corner is on the photo. Either may be negative, or the frame may run past the photo: that part is empty.
  const x0 = Math.round(W > f.w ? f.fx - W / 2 : Math.min(Math.max(f.fx - W / 2, 0), f.w - W));
  let y0 = Math.round(Math.min(f.fy - EYE * H, crown - .03 * H)); if (crown <= 2) y0 = Math.max(y0, 0);
  const left = Math.max(x0, 0), top = Math.max(y0, 0), right = Math.min(x0 + w, f.w), bottom = Math.min(y0 + h, f.h);
  // Two passes, as sharp pads after it resizes whatever order they are asked for in.
  const framed = await sharp(`${from}/${key}.png`).extract({ left, top, width: right - left, height: bottom - top })
    .extend({ left: left - x0, top: top - y0, right: x0 + w - right, bottom: y0 + h - bottom, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const px = await sharp(framed).resize(OUT[0], OUT[1], { fit: "fill" }).ensureAlpha().raw().toBuffer();
  if (px.length !== OUT[0] * OUT[1] * 4) throw new Error(`${key}: ${px.length} bytes, not a ${OUT[0]} by ${OUT[1]} frame`);
  // The photo's own edges inside the frame, in the frame's pixels, and how far from each the person is fully there.
  const sx = OUT[0] / w, sy = OUT[1] / h, L = (left - x0) * sx, R = (right - x0) * sx, B = (bottom - y0) * sy, SIDE = 46, FOOT = 72;
  for (let y = 0; y < OUT[1]; y++) for (let x = 0; x < OUT[0]; x++) {
    let k = 1; if (L > 0) k *= ease((x - L) / SIDE); if (R < OUT[0]) k *= ease((R - x) / SIDE); if (B < OUT[1]) k *= ease((B - y) / FOOT);
    if (k < 1) px[(y * OUT[0] + x) * 4 + 3] *= k;
  }
  const a = await sharp(px, { raw: { width: OUT[0], height: OUT[1], channels: 4 } }).avif({ quality: 58, effort: 7 }).toFile(`${out}${key}.avif`);
  const side = Math.round(Math.min(f.fh * 1.7, f.w, f.h)), fl = Math.round(Math.min(Math.max(f.fx - side / 2, 0), f.w - side)), ft = Math.round(Math.min(Math.max(f.fy - side * .54, 0), f.h - side));
  const b = await sharp(`${from}/${key}.png`).extract({ left: fl, top: ft, width: side, height: side }).resize(160, 160).avif({ quality: 58, effort: 7 }).toFile(`${out}${key}-face.avif`);
  console.log(key, Math.round(a.size / 1024), "KB,", Math.round(b.size / 1024), "KB, photo covers x", Math.round(L / OUT[0] * 100) + "% to", Math.round(R / OUT[0] * 100) + "%, down to", Math.round(B / OUT[1] * 100) + "%");
}
