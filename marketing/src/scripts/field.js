// The field: every paper as one lit point, in plain WebGL2. Each shape is computed once and uploaded; the GPU moves the points between two shapes per frame.
const VS = `#version 300 es
in vec4 a_from; in vec4 a_to; in vec2 a_seed;
uniform mat4 u_view; uniform mat3 u_rotA; uniform mat3 u_rotB; uniform float u_mix, u_time, u_size, u_warmA, u_warmB, u_swirl, u_scaleA, u_scaleB, u_waveA, u_waveB, u_pull, u_ring, u_ringR, u_burst, u_gain;
uniform vec3 u_ptr;
uniform vec2 u_dirA, u_dirB;
out vec4 v_color;
void main() {
  float s = a_seed.x, st = 0.45;
  float t = clamp(u_mix * (1.0 + st) - s * st, 0.0, 1.0); t = t * t * (3.0 - 2.0 * t);
  vec3 a = u_rotA * (a_from.xyz * vec3(u_scaleA, u_scaleA, 1.0)), b = u_rotB * (a_to.xyz * vec3(u_scaleB, u_scaleB, 1.0));
  vec3 p = mix(a, b, t);
  float arc = sin(t * 3.14159);
  vec3 swirl = vec3(-p.y, p.x, sin(s * 40.0)) * (0.35 + s);
  p += swirl * arc * u_swirl;
  p += 0.006 * vec3(sin(u_time * 0.5 + s * 90.0), cos(u_time * 0.4 + s * 70.0), sin(u_time * 0.3 + s * 50.0));
  p *= 1.0 - u_pull * (0.28 + 0.2 * sin(s * 30.0));
  p *= 1.0 - u_burst * (1.0 - s * 0.35);
  vec2 dp = p.xy - u_ptr.xy; float pf = u_ptr.z * exp(-dot(dp, dp) * 7.0);
  p.xy += vec2(-dp.y, dp.x) * pf * 0.42 + dp * pf * 0.1;
  float rd = length(a_from.xy) - u_ringR, rp = u_ring * exp(-rd * rd * 40.0);
  p.z += rp * 0.12;
  float bright = mix(abs(a_from.w), abs(a_to.w), t) * (1.0 + rp * 4.0 + pf * 2.2) * u_gain;
  float spec = mix(a_from.w < 0.0 ? 1.0 : 0.0, a_to.w < 0.0 ? 1.0 : 0.0, t);
  vec2 dir = mix(u_dirA, u_dirB, t);
  float wave = mix(u_waveA, u_waveB, t);
  bright *= 1.0 + wave * sin(dot(p.xy, dir) * 16.0 - u_time * 3.2 + s * 6.283);
  vec4 clip = u_view * vec4(p, 1.0);
  gl_Position = clip;
  gl_PointSize = clamp(u_size * (0.62 + sqrt(max(bright, 0.0)) * 1.5) / clip.w, 1.4, 40.0);
  float warm = mix(u_warmA, u_warmB, t) * a_seed.y;
  vec3 cool = mix(vec3(0.30, 0.50, 1.0), vec3(0.92, 0.96, 1.0), clamp(bright * 1.1, 0.0, 1.0));
  vec3 hot = vec3(1.0, 0.74, 0.48);
  vec3 col = mix(cool, hot, warm);
  float h = clamp((s - 0.34) / 0.24, 0.0, 1.0); vec3 sp = h < 0.33 ? mix(vec3(0.95, 0.35, 0.3), vec3(1.0, 0.75, 0.3), h / 0.33) : h < 0.66 ? mix(vec3(1.0, 0.75, 0.3), vec3(0.4, 0.95, 0.65), (h - 0.33) / 0.33) : mix(vec3(0.4, 0.95, 0.65), vec3(0.35, 0.6, 1.0), (h - 0.66) / 0.34);
  v_color = vec4(mix(col, sp, spec), min(1.0, bright) * (1.0 + 0.5 * arc));
}`;
const FS = `#version 300 es
precision mediump float; in vec4 v_color; out vec4 o;
void main() { float r = length(gl_PointCoord - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - r), 2.4); o = vec4(v_color.rgb * a * v_color.a, 1.0); }`;

const TAU = Math.PI * 2;
const gauss = (r) => Math.sqrt(-2 * Math.log(Math.max(1e-6, r())) ) * Math.cos(TAU * r());
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

export { mulberry };
/** Reads the packed papers: their region, year and citations, plus a seed for each. */
export function readPapers(field, count) {
  const seedA = new Float32Array(count * 2), reg = new Uint8Array(count), yr = new Uint8Array(count), cit = new Uint8Array(count), rand = mulberry(7);
  for (let i = 0; i < count; i++) { reg[i] = field[i * 3]; yr[i] = field[i * 3 + 1]; cit[i] = field[i * 3 + 2]; }
  // A paper's rank by year: the oldest at the centre of the galaxy, this year at its rim.
  const rank = new Float32Array(count); { const idx = Array.from({ length: count }, (_, i) => i).sort((a, b) => yr[a] - yr[b] || a - b); idx.forEach((p, k) => (rank[p] = k / count)); }
  for (let i = 0; i < count; i++) { seedA[i * 2] = rand(); seedA[i * 2 + 1] = Math.pow(1 - rank[i], 2.2); }
  const core = (i) => i % 7 === 0;
  const bright = (i) => 0.2 + Math.pow(cit[i] / 255, 2.4) * 3.2;
  const galaxy = (o) => { const r = mulberry(11); for (let i = 0; i < count; i++) {
    if (core(i)) { const a = r() * TAU, rr = Math.pow(r(), 1.8) * 0.42 + 0.004; o[i * 4] = Math.cos(a) * rr; o[i * 4 + 1] = Math.sin(a) * rr; o[i * 4 + 2] = gauss(r) * rr * 0.62; o[i * 4 + 3] = 0.3 + bright(i) * 0.5; seedA[i * 2 + 1] = 1 - rr; continue; }
    const halo = reg[i] === 10, R = 0.03 + 1.9 * Math.pow(rank[i], 0.92), arm = (reg[i] % 5) / 5 * TAU + (reg[i] >= 5 ? 0.42 : 0);
    const spread = 0.055 + 0.42 * Math.exp(-R * 2.4); const th = (halo ? r() * TAU : arm + gauss(r) * spread) + 2.5 * Math.log(1 + 3 * R); const bulge = Math.exp(-R * 4.2);
    const rr = R * (1 + gauss(r) * 0.035);
    o[i * 4] = Math.cos(th) * rr; o[i * 4 + 1] = Math.sin(th) * rr; o[i * 4 + 2] = gauss(r) * (0.014 + bulge * 0.2 * Math.min(1, R * 2.5)); o[i * 4 + 3] = bright(i) * (halo ? 0.4 : 1);
  } };
  return { seedA, bright, galaxy };
}
function mulberry(a) { return () => { a |= 0; a = a + 0x6d2b79f5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export function createField(canvas, { count, seeds, targets, sizeScale = 1 }) {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: true, depth: false, powerPreference: "high-performance", premultipliedAlpha: false });
  if (!gl) return null;
  const shader = (t, s) => { const h = gl.createShader(t); gl.shaderSource(h, s); gl.compileShader(h); if (!gl.getShaderParameter(h, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(h)); return h; };
  const prog = gl.createProgram(); gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); gl.useProgram(prog);
  const u = Object.fromEntries(["u_view", "u_rotA", "u_rotB", "u_mix", "u_time", "u_size", "u_warmA", "u_warmB", "u_swirl", "u_scaleA", "u_scaleB", "u_waveA", "u_waveB", "u_dirA", "u_dirB", "u_pull", "u_ring", "u_ringR", "u_burst", "u_ptr", "u_gain"].map((n) => [n, gl.getUniformLocation(prog, n)]));
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
  const render = ({ a, b, mix, time, eye, center, fov = 0.72, swirl = 0, rotA, rotB, moving, scaleA = 1, scaleB = 1, pull = 0, ring = 0, ringR = 0, idle = false, burst = 0, ptr = [0, 0, 0] }) => {
    if (last) { const dt = time - last; if (dt > (idle ? 0.07 : 0.034)) slow++; else if (slow > 0) slow -= 0.25; if (slow > 40 && draw > 30000) { draw = Math.round(draw * 0.72); slow = 0; } } last = time;
    viewM = mul(persp(fov, w / h, 0.05, 40), lookAt(eye, center));
    gl.clear(gl.COLOR_BUFFER_BIT); bind(a, b);
    gl.uniformMatrix4fv(u.u_view, false, viewM); gl.uniformMatrix3fv(u.u_rotA, false, rotA); gl.uniformMatrix3fv(u.u_rotB, false, rotB);
    gl.uniform1f(u.u_mix, mix); gl.uniform1f(u.u_time, time); gl.uniform1f(u.u_size, 7.2 * dpr * sizeScale * Math.min(1.25, Math.max(0.8, h / dpr / 900))); gl.uniform1f(u.u_swirl, moving ? swirl : 0);
    gl.uniform1f(u.u_warmA, targets[a].warm ?? 0); gl.uniform1f(u.u_warmB, targets[b].warm ?? 0);
    gl.uniform1f(u.u_scaleA, scaleA); gl.uniform1f(u.u_scaleB, scaleB); gl.uniform1f(u.u_pull, pull); gl.uniform1f(u.u_ring, ring); gl.uniform1f(u.u_ringR, ringR); gl.uniform1f(u.u_burst, burst); gl.uniform3fv(u.u_ptr, ptr); gl.uniform1f(u.u_gain, Math.sqrt(count / draw)); gl.uniform1f(u.u_waveA, targets[a].wave ?? 0); gl.uniform1f(u.u_waveB, targets[b].wave ?? 0); gl.uniform2fv(u.u_dirA, targets[a].dir ?? [1, 0]); gl.uniform2fv(u.u_dirB, targets[b].dir ?? [1, 0]);
    gl.drawArrays(gl.POINTS, 0, draw);
  };
  /** Where a point in the scene lands on screen, in CSS pixels. */
  const project = (x, y, z = 0) => { if (!viewM) return null; const m = viewM, cw = m[3] * x + m[7] * y + m[11] * z + m[15]; return [(((m[0] * x + m[4] * y + m[8] * z + m[12]) / cw) * 0.5 + 0.5) * (w / dpr), ((1 - ((m[1] * x + m[5] * y + m[9] * z + m[13]) / cw)) * 0.5) * (h / dpr)]; };
  return { render, project, gl };
}
export { mat3Tilt, I3 };
