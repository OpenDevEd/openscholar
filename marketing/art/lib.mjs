// Star-plate rendering: light is added up in linear float, then tone mapped to the brand's blue ramp.
import sharp from "sharp";

export const out = new URL("../public/img/", import.meta.url).pathname;

export function plate(w, h) {
  const light = new Float32Array(w * h);
  const stamp = (x, y, v) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) return;
    const i = y0 * w + x0;
    light[i] += v * (1 - fx) * (1 - fy); light[i + 1] += v * fx * (1 - fy);
    light[i + w] += v * (1 - fx) * fy; light[i + w + 1] += v * fx * fy;
  };
  const star = (x, y, v, r) => {
    if (r <= 1) return stamp(x, y, v);
    const R = Math.ceil(r * 2.2);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const d = (dx * dx + dy * dy) / (r * r);
      if (d < 4.8) stamp(x + dx, y + dy, v * Math.exp(-d * 1.4));
    }
  };
  const line = (x1, y1, x2, y2, v) => {
    const n = Math.ceil(Math.hypot(x2 - x1, y2 - y1));
    for (let k = 0; k <= n; k++) stamp(x1 + (x2 - x1) * k / n, y1 + (y2 - y1) * k / n, v);
  };
  return { w, h, light, stamp, star, line };
}

/** A soft copy of the light, so dense areas read as a haze of stars rather than flat fill. */
export function haze(p, radius, amount) {
  const { w, h, light } = p;
  let a = Float32Array.from(light), b = new Float32Array(w * h);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) { let s = 0; for (let x = -radius; x < w; x++) { if (x + radius < w) s += a[y * w + x + radius]; if (x - radius - 1 >= 0) s -= a[y * w + x - radius - 1]; if (x >= 0) b[y * w + x] = s / (2 * radius + 1); } }
    for (let x = 0; x < w; x++) { let s = 0; for (let y = -radius; y < h; y++) { if (y + radius < h) s += b[(y + radius) * w + x]; if (y - radius - 1 >= 0) s -= b[(y - radius - 1) * w + x]; if (y >= 0) a[y * w + x] = s / (2 * radius + 1); } }
  }
  for (let i = 0; i < light.length; i++) light[i] += a[i] * amount;
}

const RAMP = [[0, [0, 0, 0]], [0.1, [8, 15, 44]], [0.3, [23, 37, 84]], [0.5, [29, 78, 216]], [0.68, [59, 130, 246]], [0.84, [147, 197, 253]], [1, [255, 255, 255]]];
const rgb = (t) => {
  for (let k = 1; k < RAMP.length; k++) if (t <= RAMP[k][0]) {
    const [a, ca] = RAMP[k - 1], [b, cb] = RAMP[k], f = (t - a) / (b - a);
    return [ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f];
  }
  return RAMP.at(-1)[1];
};

/** Tone maps the light into RGB, adding any coloured marks painted on top. */
export function develop(p, exposure, marks) {
  const { w, h, light } = p;
  const lut = Array.from({ length: 2049 }, (_, i) => rgb(i / 2048));
  const buf = Buffer.alloc(w * h * 3);
  for (let i = 0; i < light.length; i++) {
    const [r, g, b] = lut[Math.round((1 - Math.exp(-light[i] * exposure)) * 2048)];
    const m = marks && (marks[i * 3] || marks[i * 3 + 1] || marks[i * 3 + 2]); buf[i * 3] = m ? marks[i * 3] : r; buf[i * 3 + 1] = m ? marks[i * 3 + 1] : g; buf[i * 3 + 2] = m ? marks[i * 3 + 2] : b;
  }
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } });
}

/** Writes sizes of one image as AVIF, and says how big they came out. */
export async function save(image, name, widths, { quality = 58 } = {}) {
  const raw = await image.png().toBuffer();
  for (const width of widths) {
    const info = await sharp(raw).resize({ width }).avif({ quality, effort: 6, chromaSubsampling: "4:4:4" }).toFile(`${out}${name}-${width}.avif`);
    console.log(`${name}-${width}.avif`, info.width, info.height, Math.round(info.size / 1024) + " KB");
  }
}
