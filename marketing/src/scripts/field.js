// The field: every paper as one lit point, in plain WebGL2. Each shape is computed once and uploaded; the GPU moves the points between two shapes per frame.
const VS = `#version 300 es
in vec4 a_from; in vec4 a_to; in vec2 a_seed;
uniform mat4 u_view; uniform mat3 u_rotA; uniform mat3 u_rotB; uniform float u_mix, u_time, u_size, u_warmA, u_warmB, u_swirl;
out vec4 v_color;
void main() {
  float s = a_seed.x, st = 0.45;
  float t = clamp(u_mix * (1.0 + st) - s * st, 0.0, 1.0); t = t * t * (3.0 - 2.0 * t);
  vec3 a = u_rotA * a_from.xyz, b = u_rotB * a_to.xyz;
  vec3 p = mix(a, b, t);
  float arc = sin(t * 3.14159);
  vec3 swirl = vec3(-p.y, p.x, sin(s * 40.0)) * (0.35 + s);
  p += swirl * arc * u_swirl;
  p += 0.006 * vec3(sin(u_time * 0.5 + s * 90.0), cos(u_time * 0.4 + s * 70.0), sin(u_time * 0.3 + s * 50.0));
  float bright = mix(a_from.w, a_to.w, t);
  vec4 clip = u_view * vec4(p, 1.0);
  gl_Position = clip;
  gl_PointSize = clamp(u_size * (0.62 + sqrt(bright) * 1.5) / clip.w, 1.4, 40.0);
  float warm = mix(u_warmA, u_warmB, t) * a_seed.y;
  vec3 cool = mix(vec3(0.30, 0.50, 1.0), vec3(0.92, 0.96, 1.0), clamp(bright * 1.1, 0.0, 1.0));
  vec3 hot = vec3(1.0, 0.74, 0.48);
  v_color = vec4(mix(cool, hot, warm), min(1.0, bright) * (1.0 + 0.5 * arc));
}`;
const FS = `#version 300 es
precision mediump float; in vec4 v_color; out vec4 o;
void main() { float r = length(gl_PointCoord - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - r), 2.4); o = vec4(v_color.rgb * a * v_color.a, 1.0); }`;

const TAU = Math.PI * 2;
const gauss = (r) => Math.sqrt(-2 * Math.log(Math.max(1e-6, r())) ) * Math.cos(TAU * r());
function mat3Y(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 1, 0, s, 0, c]; }
function mat3Tilt(ax, az) { const cx = Math.cos(ax), sx = Math.sin(ax), cz = Math.cos(az), sz = Math.sin(az); return [cz, sz * cx, sz * sx, -sz, cz * cx, cz * sx, 0, -sx, cx]; }
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function lookAt(e, c) {
  let z = [e[0] - c[0], e[1] - c[1], e[2] - c[2]], l = Math.hypot(...z); z = z.map((v) => v / l);
  let x = [z[2], 0, -z[0]]; l = Math.hypot(...x); x = x.map((v) => v / l);
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -(x[0] * e[0] + x[1] * e[1] + x[2] * e[2]), -(y[0] * e[0] + y[1] * e[1] + y[2] * e[2]), -(z[0] * e[0] + z[1] * e[1] + z[2] * e[2]), 1];
}
const persp = (fov, asp, n, f) => { const t = 1 / Math.tan(fov / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]; };
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const ease = (t) => t * t * (3 - 2 * t);

export { mulberry };
/** Shapes the points can take. Each returns nothing and fills `o` (xyz + brightness per point). */
export const YEAR_FROM = 2008;
export function makeShapes({ field, earth, mark, count }) {
  const seedA = new Float32Array(count * 2);
  const reg = new Uint8Array(count), yr = new Uint8Array(count), cit = new Uint8Array(count);
  const rand = mulberry(7);
  for (let i = 0; i < count; i++) { reg[i] = field[i * 3]; yr[i] = field[i * 3 + 1]; cit[i] = field[i * 3 + 2]; }
  // A paper's rank by year: the oldest at the centre of the galaxy, this year at its rim.
  const rank = new Float32Array(count); { const idx = Array.from({ length: count }, (_, i) => i).sort((a, b) => yr[a] - yr[b] || a - b); idx.forEach((p, k) => (rank[p] = k / count)); }
  for (let i = 0; i < count; i++) { seedA[i * 2] = rand(); seedA[i * 2 + 1] = Math.pow(1 - rank[i], 2.2); }
  const bright = (i) => 0.2 + Math.pow(cit[i] / 255, 2.4) * 3.2;
  const galaxy = (o) => { const r = mulberry(11); for (let i = 0; i < count; i++) {
    const halo = reg[i] === 10, R = 0.03 + 1.9 * Math.pow(rank[i], 0.92), arm = (reg[i] % 5) / 5 * TAU + (reg[i] >= 5 ? 0.42 : 0);
    const spread = 0.055 + 0.42 * Math.exp(-R * 2.4); const th = (halo ? r() * TAU : arm + gauss(r) * spread) + 2.5 * Math.log(1 + 3 * R); const bulge = Math.exp(-R * 4.2);
    const rr = R * (1 + gauss(r) * 0.035);
    o[i * 4] = Math.cos(th) * rr; o[i * 4 + 1] = Math.sin(th) * rr; o[i * 4 + 2] = gauss(r) * (0.014 + bulge * 0.2); o[i * 4 + 3] = bright(i) * (halo ? 0.4 : 1);
  } };
  const select = (o, g, region) => { for (let i = 0; i < count; i++) { o[i * 4] = g[i * 4]; o[i * 4 + 1] = g[i * 4 + 1]; o[i * 4 + 2] = g[i * 4 + 2]; o[i * 4 + 3] = reg[i] === region ? 0.55 + bright(i) * 0.9 : 0.035; } };
  // Bars of the real year counts, made of the papers themselves.
  const years = (o) => { const r = mulberry(13), cols = 2026 - YEAR_FROM + 1, used = new Int32Array(cols + 1); const counts = new Int32Array(cols + 1);
    const col = (i) => { const y = yr[i] + 1949; return y < YEAR_FROM ? -1 : Math.min(cols - 1, y - YEAR_FROM); };
    let max = 0; for (let i = 0; i < count; i++) { const c = col(i); if (c >= 0) { counts[c]++; if (counts[c] > max) max = counts[c]; } }
    const W = 2.7, H = 1.45, w = W / cols; for (let i = 0; i < count; i++) { const c = col(i);
      if (c < 0) { o[i * 4] = -W / 2 - 0.3 + r() * 0.2; o[i * 4 + 1] = r() * 0.02; o[i * 4 + 2] = gauss(r) * 0.2; o[i * 4 + 3] = 0.05; continue; }
      const k = used[c]++, up = r(); o[i * 4] = -W / 2 + w * c + r() * w * 0.74; o[i * 4 + 1] = up * counts[c] / max * H; o[i * 4 + 2] = (r() - 0.5) * w * 0.74; o[i * 4 + 3] = (0.34 + bright(i) * 0.5) * (0.65 + 0.7 * Math.pow(up, 3));
    } return { W, H, cols };
  };
  // A beam through three gates: most stop at a gate and fall, a few carry on.
  const gates = (o) => { const r = mulberry(17), X = [-0.85, 0, 0.85]; for (let i = 0; i < count; i++) { const h = seedA[i * 2]; const stop = h < 0.5 ? 0 : h < 0.8 ? 1 : h < 0.93 ? 2 : 3; const ring = r() < 0.03 && stop < 3;
    if (ring) { const a = r() * TAU, rr = 0.42; o[i * 4] = X[stop]; o[i * 4 + 1] = Math.cos(a) * rr; o[i * 4 + 2] = Math.sin(a) * rr; o[i * 4 + 3] = 0.9; continue; }
    const narrow = (x) => (x < X[0] ? 0.3 : x < X[1] ? 0.19 : x < X[2] ? 0.11 : 0.05);
    if (r() < 0.55 && stop < 3) { const fall = Math.pow(r(), 1.5); o[i * 4] = X[stop] + 0.04 + r() * 0.1 + fall * 0.14; o[i * 4 + 1] = -fall * 1.2 - r() * 0.05; o[i * 4 + 2] = gauss(r) * (0.1 + fall * 0.22); o[i * 4 + 3] = (0.25 + bright(i) * 0.4) * (1 - fall * 0.85); }
    else { const end = stop < 3 ? X[stop] : 1.9, x = -1.9 + r() * (end + 1.9), n = narrow(x); o[i * 4] = x; o[i * 4 + 1] = gauss(r) * n * 0.42; o[i * 4 + 2] = gauss(r) * n * 0.42; o[i * 4 + 3] = 0.3 + bright(i) * 0.5; }
  } };
  // A matrix: rows of papers, columns of questions.
  const matrix = (o, rows, cols) => { const r = mulberry(19), X0 = -0.16, W = 1.62, H = 1.5, cw = W / cols, ch = H / rows; for (let i = 0; i < count; i++) { const h = seedA[i * 2]; if (h > 0.5) { const a = r() * TAU, R = 2.3 + r() * 1.6; o[i * 4] = Math.cos(a) * R; o[i * 4 + 1] = Math.sin(a) * R * 0.7; o[i * 4 + 2] = -1 - r() * 2; o[i * 4 + 3] = 0.05; continue; }
    const c = Math.floor(r() * cols), row = Math.floor(r() * rows); const edge = r() < 0.16; let dx = r(), dy = r(); if (edge) { if (r() < 0.5) dx = r() < 0.5 ? 0 : 1; else dy = r() < 0.5 ? 0 : 1; }
    o[i * 4] = X0 + c * cw + cw * 0.05 + dx * cw * 0.9; o[i * 4 + 1] = H / 2 - row * ch - ch * 0.08 - dy * ch * 0.84; o[i * 4 + 2] = gauss(r) * 0.006; o[i * 4 + 3] = edge ? 0.4 : 0.05;
  } return { X0, W, H, cw, ch }; };
  // A ring around the assistant.
  const ring = (o) => { const r = mulberry(23); for (let i = 0; i < count; i++) { const a = r() * TAU, band = gauss(r), R = 1.32 + band * 0.1 + 0.02 * Math.sin(a * 13), t = gauss(r) * (0.05 + Math.abs(band) * 0.05); o[i * 4] = Math.cos(a) * R; o[i * 4 + 1] = Math.sin(a) * R; o[i * 4 + 2] = t; o[i * 4 + 3] = (0.22 + bright(i) * 0.7) * Math.exp(-band * band * 0.45); } };
  const earthPts = new Int16Array(earth.buffer, earth.byteOffset, earth.byteLength / 2), inst = 9988;
  const globe = (o) => { const land = (earthPts.length - 2 - inst * 2) / 2, R = 1.08, rad = Math.PI / 180, r = mulberry(29); for (let i = 0; i < count; i++) { let lon, lat, b; if (i < inst) { lon = earthPts[2 + i * 2] / 100; lat = earthPts[3 + i * 2] / 100; b = 0.72; } else if (i - inst < land) { const k = i - inst; lon = earthPts[2 + inst * 2 + k * 2] / 100; lat = earthPts[3 + inst * 2 + k * 2] / 100; b = 0.3; } else { lon = r() * 360 - 180; lat = Math.asin(r() * 2 - 1) / rad; b = 0.02; }
      const cl = Math.cos(lat * rad); o[i * 4] = R * cl * Math.sin(lon * rad); o[i * 4 + 1] = R * Math.sin(lat * rad); o[i * 4 + 2] = R * cl * Math.cos(lon * rad); o[i * 4 + 3] = b; } };
  const logo = (o) => { const m = new Uint16Array(mark.buffer, mark.byteOffset, mark.byteLength / 2), n = m.length / 3, r = mulberry(31), S = 0.78; for (let i = 0; i < count; i++) { if (i < n * 3) { const k = i % n; o[i * 4] = (m[k * 3] / 900 - 0.5) * 2 * S + r() * 0.002; o[i * 4 + 1] = -(m[k * 3 + 1] / 900 - 0.5) * 2 * S + 0.3 + r() * 0.002; o[i * 4 + 2] = gauss(r) * 0.012; o[i * 4 + 3] = Math.pow(m[k * 3 + 2] / 255, 0.6) * 0.8; } else { const a = r() * TAU, R = 2.6 + r() * 2; o[i * 4] = Math.cos(a) * R; o[i * 4 + 1] = Math.sin(a) * R * 0.7; o[i * 4 + 2] = -2 - r() * 2; o[i * 4 + 3] = 0.04; } } };
  return { seedA, reg, yr, galaxy, select, years, gates, matrix, ring, globe, logo };
}
function mulberry(a) { return () => { a |= 0; a = a + 0x6d2b79f5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export function createField(canvas, { count, seeds, targets, sizeScale = 1 }) {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: true, depth: false, powerPreference: "high-performance", premultipliedAlpha: false });
  if (!gl) return null;
  const shader = (t, s) => { const h = gl.createShader(t); gl.shaderSource(h, s); gl.compileShader(h); if (!gl.getShaderParameter(h, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(h)); return h; };
  const prog = gl.createProgram(); gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); gl.useProgram(prog);
  const u = Object.fromEntries(["u_view", "u_rotA", "u_rotB", "u_mix", "u_time", "u_size", "u_warmA", "u_warmB", "u_swirl"].map((n) => [n, gl.getUniformLocation(prog, n)]));
  const buffers = targets.map((t) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, t.data, gl.STATIC_DRAW); t.data = null; return b; });
  const seedBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, seedBuf); gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
  const aFrom = gl.getAttribLocation(prog, "a_from"), aTo = gl.getAttribLocation(prog, "a_to"), aSeed = gl.getAttribLocation(prog, "a_seed");
  gl.enableVertexAttribArray(aFrom); gl.enableVertexAttribArray(aTo); gl.enableVertexAttribArray(aSeed); gl.bindBuffer(gl.ARRAY_BUFFER, seedBuf); gl.vertexAttribPointer(aSeed, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.clearColor(0, 0, 0, 0);
  let draw = count, w = 0, h = 0, dpr = 1, boundFrom = -1, boundTo = -1;
  const bind = (a, b) => { if (a !== boundFrom) { gl.bindBuffer(gl.ARRAY_BUFFER, buffers[a]); gl.vertexAttribPointer(aFrom, 4, gl.FLOAT, false, 0, 0); boundFrom = a; } if (b !== boundTo) { gl.bindBuffer(gl.ARRAY_BUFFER, buffers[b]); gl.vertexAttribPointer(aTo, 4, gl.FLOAT, false, 0, 0); boundTo = b; } };
  const resize = () => { dpr = Math.min(devicePixelRatio || 1, 1.75); const r = canvas.getBoundingClientRect(); w = Math.round(r.width * dpr); h = Math.round(r.height * dpr); if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); } };
  resize(); new ResizeObserver(resize).observe(canvas);
  let viewM = null, slow = 0, last = 0;
  const render = ({ a, b, mix, time, eye, center, fov = 0.72, swirl = 0, rotA, rotB, moving }) => {
    if (last) { const dt = time - last; if (dt > 0.034) slow++; else if (slow > 0) slow -= 0.25; if (slow > 40 && draw > 30000) { draw = Math.round(draw * 0.72); slow = 0; } } last = time;
    viewM = mul(persp(fov, w / h, 0.05, 40), lookAt(eye, center));
    gl.clear(gl.COLOR_BUFFER_BIT); bind(a, b);
    gl.uniformMatrix4fv(u.u_view, false, viewM); gl.uniformMatrix3fv(u.u_rotA, false, rotA); gl.uniformMatrix3fv(u.u_rotB, false, rotB);
    gl.uniform1f(u.u_mix, mix); gl.uniform1f(u.u_time, time); gl.uniform1f(u.u_size, 7.2 * dpr * sizeScale * Math.min(1.25, Math.max(0.8, h / dpr / 900))); gl.uniform1f(u.u_swirl, moving ? swirl : 0);
    gl.uniform1f(u.u_warmA, targets[a].warm ?? 0); gl.uniform1f(u.u_warmB, targets[b].warm ?? 0);
    gl.drawArrays(gl.POINTS, 0, draw);
  };
  /** Where a point in the scene lands on screen, in CSS pixels. */
  const project = (x, y, z = 0) => { if (!viewM) return null; const m = viewM, cw = m[3] * x + m[7] * y + m[11] * z + m[15]; return [(((m[0] * x + m[4] * y + m[8] * z + m[12]) / cw) * 0.5 + 0.5) * (w / dpr), ((1 - ((m[1] * x + m[5] * y + m[9] * z + m[13]) / cw)) * 0.5) * (h / dpr)]; };
  return { render, project, gl };
}
export { mat3Y, mat3Tilt, I3, ease };
