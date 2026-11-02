import { mulberry } from "./field.js";

// Shapes drawn in the coordinates of a photograph, so light lands on what's in the picture.
export const IMG = 1672 / 941;
const TAU = Math.PI * 2;
export const uv = (u, v) => [(u - 0.5) * 2 * IMG, (0.5 - v) * 2];
const gauss = (r) => Math.sqrt(-2 * Math.log(Math.max(1e-6, r()))) * Math.cos(TAU * r());

/** How a photo covers a box of this aspect, keeping the point `f` across it in view. `pos` is its object-position, `pan` moves the camera with it. */
export function cover(asp, f = 0.5) { const over = 2 * IMG - 2 * asp; if (over <= 0) return { scale: Math.max(1, asp / IMG), pos: 0.5, pan: 0 }; const pos = Math.min(1, Math.max(0, (f - 0.5) * 2 * IMG / over + 0.5)); return { scale: 1, pos, pan: (pos - 0.5) * over }; }

export function shapes(count, seed, bright, { bars = [], asp = 1.6 } = {}) {
  const stars = (o, i, r, level = 0.07) => { o[i * 4] = (r() - 0.5) * 6; o[i * 4 + 1] = (r() - 0.5) * 3.4; o[i * 4 + 2] = -r() * 0.6; o[i * 4 + 3] = level * (0.5 + bright(i) * 0.7); };
  const line = (o, i, r, A, B, t, w, level) => { const dx = B[0] - A[0], dy = B[1] - A[1], l = Math.hypot(dx, dy) || 1, n = gauss(r) * w; o[i * 4] = A[0] + dx * t - dy / l * n; o[i * 4 + 1] = A[1] + dy * t + dx / l * n; o[i * 4 + 2] = gauss(r) * Math.abs(w) * 0.6; o[i * 4 + 3] = level; };
  // A sheet of cells, with the same points each time so it can come apart.
  const sheet = (o) => { const r = mulberry(31), W = asp * 1.15, cw = 0.2, ch = 0.11; for (let i = 0; i < count; i++) { const h = seed[i * 2]; if (h < 0.3) { if (r() < 0.5) { const x = Math.round((r() * 2 - 1) * W / cw) * cw; o[i * 4] = x; o[i * 4 + 1] = r() * 2.2 - 1.1; } else { const y = Math.round((r() * 2 - 1) / ch) * ch; o[i * 4] = (r() * 2 - 1) * W; o[i * 4 + 1] = y; } o[i * 4 + 2] = 0; o[i * 4 + 3] = 0.17; } else if (h < 0.52) { const a = mulberry(Math.floor(h * 900)), x = Math.round((a() * 2 - 1) * W / cw) * cw, y = Math.round((a() * 2 - 1) / ch) * ch, l = 0.05 + a() * 0.1; o[i * 4] = x + 0.02 + r() * l; o[i * 4 + 1] = y + 0.05 + gauss(r) * 0.005; o[i * 4 + 2] = 0; o[i * 4 + 3] = 0.45 + bright(i) * 0.3; } else { o[i * 4] = 0; o[i * 4 + 1] = 0; o[i * 4 + 2] = -3; o[i * 4 + 3] = 0; } } };
  return {
    // Rows and rows of open tabs, above and below the words.
    tabs(o) { const r = mulberry(30), W = asp * 1.15, tw = 0.24, tall = 0.075, ys = [0.86, 0.74, 0.62, -0.62, -0.74, -0.86]; for (let i = 0; i < count; i++) { const h = seed[i * 2]; if (h < 0.5) { const y = ys[Math.floor(r() * 6)], x = (Math.floor(r() * (W * 2 / tw)) - W / tw) * tw + (Math.abs(y * 100) % 2) * tw * 0.5, side = r(), t = r(); if (side < 0.25) { o[i * 4] = x + t * 0.022; o[i * 4 + 1] = y + t * tall; } else if (side < 0.75) { o[i * 4] = x + 0.022 + t * (tw - 0.044); o[i * 4 + 1] = y + tall; } else { o[i * 4] = x + tw - t * 0.022; o[i * 4 + 1] = y + t * tall; } o[i * 4 + 2] = 0; o[i * 4 + 3] = 0.24 + bright(i) * 0.36; } else stars(o, i, r, 0.03); } },
    sheet,
    // The same sheet, fallen apart.
    dust(o) { sheet(o); const r = mulberry(32); for (let i = 0; i < count; i++) { if (o[i * 4 + 2] === -3) continue; o[i * 4] += gauss(r) * 0.06; o[i * 4 + 1] -= 0.25 + Math.pow(r(), 1.6) * 1.9; o[i * 4 + 3] *= 0.85; } },
    // Everything, down to one point.
    point(o) { const r = mulberry(33), Y = -0.62; for (let i = 0; i < count; i++) { const g = seed[i * 2] < 0.3; o[i * 4] = gauss(r) * (g ? 0.012 : 0.002); o[i * 4 + 1] = Y + gauss(r) * (g ? 0.012 : 0.002); o[i * 4 + 2] = 0; o[i * 4 + 3] = g ? 0.1 + bright(i) * 0.08 : 0; } },
    // Starlight pours through the dome into the telescope's mirror.
    telescope(o) { const r = mulberry(21), A = uv(0.34, -0.3), B = uv(0.672, 0.445), top = Math.max(1, ...bars); for (let i = 0; i < count; i++) { const h = seed[i * 2]; if (bars.length && h > 0.74 && h < 0.86) { const k = Math.floor(r() * bars.length), tall = bars[k] / top, f = r() * tall; if (r() < 0.25 + tall) { const u = 0.03 + (k + 0.1 + r() * 0.8) / bars.length * 0.6, p = uv(u, 0.93 - f * 0.34); o[i * 4] = p[0]; o[i * 4 + 1] = p[1]; o[i * 4 + 2] = 0; o[i * 4 + 3] = (0.42 + bright(i) * 0.4) * Math.min(1, (0.66 - u) / 0.16); } else stars(o, i, r); } else if (h < 0.6) { const t = Math.pow(r(), 0.75); line(o, i, r, A, B, t, 0.2 * (1 - t) + 0.008, (0.16 + bright(i) * 0.4) * (0.5 + t)); } else stars(o, i, r); } },
    // A thin beam enters the prism and fans into colour. One line carries on through the slit, and the rest fall away.
    prism(o, pass = 0.05) { const r = mulberry(22), P = uv(0.565, 0.505), F = uv(0.69, 0.505), X = uv(0.8125, 0.505), E = uv(1.2, 0.505), S = uv(-0.2, 0.505); for (let i = 0; i < count; i++) { const h = seed[i * 2];
      if (h < 0.3) line(o, i, r, S, P, r(), 0.004, 0.3 + bright(i) * 0.3);
      else if (h < 0.34) line(o, i, r, P, F, r(), 0.012, 0.3);
      else if (h < 0.58) { const t = r(), hue = seed[i * 2]; o[i * 4] = F[0] + (X[0] - F[0]) * t; o[i * 4 + 1] = F[1] + ((h - 0.34) / 0.24 - 0.5) * 0.17 * t; o[i * 4 + 2] = 0; o[i * 4 + 3] = -0.55; }
      else if (h < 0.58 + pass) line(o, i, r, X, E, r(), 0.0035 + pass * 0.05, 0.75);
      else if (h < 0.86) { const f = Math.pow(r(), 1.3); o[i * 4] = X[0] - 0.03 + gauss(r) * (0.025 + f * 0.1); o[i * 4 + 1] = X[1] - f * 1.05; o[i * 4 + 2] = gauss(r) * 0.05; o[i * 4 + 3] = (0.32 + bright(i) * 0.3) * (1 - f * 0.85); }
      else stars(o, i, r); } },
    // The spectrum settles along the glass.
    spectrum(o) { const r = mulberry(23), A = uv(0.405, 0.82), B = uv(0.93, 0.19); for (let i = 0; i < count; i++) { const h = seed[i * 2]; if (h < 0.55) { const t = r(), bars = 0.5 + 0.5 * Math.sin(t * 190 + Math.sin(t * 37) * 6); line(o, i, r, A, B, t, 0.012, (0.1 + bars * 0.5) * (0.6 + bright(i) * 0.4)); } else if (h < 0.62) { const t = r(); line(o, i, r, A, B, t, 0.11, 0.08); } else stars(o, i, r); } },
    // The dial, with work orbiting it.
    console(o) { const r = mulberry(24), C = uv(0.806, 0.4); for (let i = 0; i < count; i++) { const h = seed[i * 2]; if (h < 0.42) { const a = r() * TAU, R = 0.22 + gauss(r) * 0.012 + (h < 0.14 ? 0.1 : 0); o[i * 4] = C[0] + Math.cos(a) * R * 1.25; o[i * 4 + 1] = C[1] + Math.sin(a) * R * 0.74; o[i * 4 + 2] = Math.sin(a) * R * 0.5; o[i * 4 + 3] = 0.16 + bright(i) * 0.5; } else stars(o, i, r); } },
    // Every dish on one patch of sky.
    array(o) { const r = mulberry(25), T = uv(0.5, 0.1), D = [0.106, 0.225, 0.344, 0.456, 0.569, 0.681, 0.8, 0.913]; for (let i = 0; i < count; i++) { const h = seed[i * 2]; if (h < 0.16) { const d = uv(D[Math.floor(r() * 8)], 0.6), t = r(); line(o, i, r, d, T, t, 0.003, 0.16 * (0.4 + t)); } else if (h < 0.34) { o[i * 4] = T[0] + gauss(r) * 0.09; o[i * 4 + 1] = T[1] + gauss(r) * 0.06; o[i * 4 + 2] = 0; o[i * 4 + 3] = 0.2 + bright(i) * 0.7; } else { o[i * 4] = (r() - 0.5) * 5.6; o[i * 4 + 1] = r() * 1.5 - 0.02; o[i * 4 + 2] = -r() * 0.4; o[i * 4 + 3] = 0.06 + bright(i) * 0.28; } } },
    // The light lands on the glass plate.
    plate(o) { const r = mulberry(26), TL = uv(0.69, 0.32), TR = uv(0.906, 0.31), BL = uv(0.68, 0.62), BR = uv(0.9, 0.6), S = uv(0.12, -0.2); for (let i = 0; i < count; i++) { const h = seed[i * 2]; if (h < 0.34) { const a = r(), b = r(), e = [TL[0] + (TR[0] - TL[0]) * a + (BL[0] - TL[0]) * b, TL[1] + (TR[1] - TL[1]) * a + (BL[1] - TL[1]) * b]; const t = Math.pow(r(), 0.55); line(o, i, r, S, e, t, 0.06 * (1 - t) + 0.002, 0.1 + bright(i) * 0.25); } else stars(o, i, r); } },
    // Everything settles along the edge of a world.
    horizon(o) { const r = mulberry(27), R = 5.77, C = uv(0.5, 0.622), cy = C[1] - R; for (let i = 0; i < count; i++) { const h = seed[i * 2]; if (h < 0.5) { const x = (r() - 0.5) * 3.6, y = cy + Math.sqrt(R * R - x * x) + Math.abs(gauss(r)) * 0.012; o[i * 4] = x; o[i * 4 + 1] = y; o[i * 4 + 2] = 0; o[i * 4 + 3] = (0.1 + bright(i) * 0.3) * Math.max(0.05, 1 - Math.abs(x) / 1.75); } else { o[i * 4] = (r() - 0.5) * 6; o[i * 4 + 1] = C[1] + r() * 1.6; o[i * 4 + 2] = -r() * 0.5; o[i * 4 + 3] = 0.05 + bright(i) * 0.3; } } },
  };
}
