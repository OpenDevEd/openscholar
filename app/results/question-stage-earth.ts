/**
 * The marketing hero's Earth (marketing/src/components/HomeHero.astro): NASA imagery drawn by a small
 * shader, with day, night, weather and sea glint, and its ring with a spark of light going round.
 */

const DIR = "/question-stage";
export const EARTH_IMAGES = [`${DIR}/earth-day.avif`, `${DIR}/earth-night.avif`, `${DIR}/earth-clouds.avif`, `${DIR}/earth-water.avif`];
export const SKY_PLATE = `${DIR}/sky-plate.avif`;

const SVG = "http://www.w3.org/2000/svg";
const VERTEX = `#version 300 es\nin vec2 a; void main(){ gl_Position = vec4(a, 0., 1.); }`;
const FRAGMENT = `#version 300 es
precision highp float; out vec4 o; uniform sampler2D day, night, clouds, water; uniform vec2 c; uniform float r, t, wv, fd; uniform vec3 L, rg;
const float PI = 3.14159265;
float gs(float x){ return exp(-x * x); }
vec2 ll(vec3 n, float spin){ float lon = atan(n.x, n.z) - spin, lat = asin(clamp(n.y, -1., 1.)), u = lon / (2. * PI); float u1 = fract(u), u2 = fract(u + .5) - .5; return vec2(fwidth(u1) < fwidth(u2) - .001 ? u1 : u2, .5 - lat / PI); }
vec3 halo(float d, float sun){ float lit = smoothstep(-.55, .75, sun), e = max(d - 1., 0.), g = (exp(-e * 22.) * .7 + exp(-e * 5.) * .08) * (1. - smoothstep(1.2, 1.5, d)); return mix(mix(vec3(.06, .16, .42), vec3(.36, .62, .95), lit), vec3(1., .56, .24), smoothstep(.5, .93, sun) * .8) * g * (.42 + lit) + vec3(1., .68, .36) * smoothstep(.55, .92, sun) * exp(-e * 26.) + vec3(1., .92, .8) * smoothstep(.82, .95, sun) * exp(-e * 70.) * .7; }
void main(){
  vec2 p = (gl_FragCoord.xy - c) / r; float d = length(p), sun = dot(normalize(vec3(p, .001)), L); vec3 h = halo(d, sun);
  if (wv > 0.) h *= 1. + 1.6 * smoothstep(0., .08, wv) * max(0., 1. - wv * 2.) * smoothstep(.1, .9, p.y);
  float ha = clamp(max(h.r, max(h.g, h.b)), 0., 1.);
  float fade = smoothstep(0., fd, gl_FragCoord.y); if (d > 1.) { o = vec4(h, ha) * fade; return; }
  float z = sqrt(1. - d * d); vec3 n0 = vec3(p, z);
  float ax = .4, ay = .22; mat3 lean = mat3(cos(ax), sin(ax), 0., -sin(ax), cos(ax), 0., 0., 0., 1.) * mat3(1., 0., 0., 0., cos(ay), -sin(ay), 0., sin(ay), cos(ay)); vec3 n = lean * n0;
  vec2 uv = ll(n, t * .05), uvc = ll(n, t * .058);
  float wet = texture(water, uv).r; vec3 dc = (texture(day, uv).rgb + wet * vec3(0., .022, .06) + (1. - wet) * vec3(.03, .04, .03)) * vec3(.97, 1., 1.05); vec3 nc = texture(night, uv).rgb; float cl = texture(clouds, uvc).r, sh = texture(clouds, uvc + vec2(.0028, -.0018)).r;
  float dif = dot(n0, L), lit = smoothstep(-.08, .46, dif), dusk = smoothstep(-.14, .08, dif) * (1. - smoothstep(.06, .22, dif));
  vec3 col = dc * (vec3(.05, .075, .13) + 1.12 * lit) * (1. - pow(sh, 1.5) * .3 * lit) + vec3(.012, .032, .085) * (1. - lit);
  col += pow(max(dot(reflect(-L, n0), vec3(0., 0., 1.)), 0.), 90.) * wet * vec3(.7, .85, 1.) * .42 * lit;
  float city = max(nc.r - .05, 0.); col += (nc * 1.1 + city * vec3(1.6, 1.1, .55) * 4.5 * (1. - cl * .8)) * (1. - smoothstep(-.2, .06, dif));
  col = mix(col, mix(vec3(.07, .11, .2), vec3(1., 1., 1.02), lit), pow(cl, 1.5) * .9);
  col += dusk * vec3(.9, .5, .25) * .07;
  col += mix(vec3(.3, .6, .95), vec3(1., .6, .3), smoothstep(.55, .93, sun) * .8) * pow(1. - z, 3.2) * (.24 + .9 * smoothstep(0., .8, dif));
  vec2 q = mat2(cos(rg.z), sin(rg.z), -sin(rg.z), cos(rg.z)) * p; float yr = -rg.y * sqrt(max(0., 1. - q.x * q.x / (rg.x * rg.x))); col *= 1. - .3 * gs((q.y - yr + .035) / .018);
  if (wv > 0.) { float g = acos(clamp(dot(n0, vec3(0., .96, .28)), -1., 1.)), f = wv * 3.2 - .2, e = smoothstep(0., .1, wv) * (1. - wv), b = gs((g - f) / .2) * e; col *= 1. + b * .75; col += b * (vec3(1., .55, .2) * .1 + city * vec3(1.6, 1.15, .6) * 9.) * (1. - cl * .7) + gs((g - f) / .06) * e * vec3(1., .7, .4) * .22 + vec3(1., .72, .42) * pow(1. - z, 2.5) * smoothstep(.1, .9, p.y) * max(0., 1. - wv * 2.) * .6; }
  col = col / (1. + col * .14); float a = 1. - smoothstep(1. - 2.2 / r, 1., d);
  o = (vec4(col, 1.) * a + vec4(h, ha) * (1. - a)) * fade;
}`;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** The ring's arcs, as the hero draws them: one half behind the planet, the other in front. */
function drawRing(svg: SVGSVGElement, a: number, b: number, front: boolean, transform: string, narrow: boolean) {
  const id = front ? "stage-spectrum-front" : "stage-spectrum-back";
  svg.innerHTML = `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${-a}" x2="${a}" y1="0" y2="0"><stop offset="0" stop-color="#ff6b35"/><stop offset=".16" stop-color="#ff9d36"/><stop offset=".34" stop-color="#ffd9ae"/><stop offset=".52" stop-color="#8fd3d8"/><stop offset=".76" stop-color="#5a9be6"/><stop offset="1" stop-color="#3c62b8"/></linearGradient><filter id="${id}-soft" x="-5%" y="-100%" width="110%" height="300%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="9"/></filter></defs>`;
  const group = document.createElementNS(SVG, "g");
  group.setAttribute("transform", transform);
  svg.append(group);
  const sweep = front ? 0 : 1;
  const arc = `M ${-a} 0 A ${a} ${b} 0 0 ${sweep} ${a} 0`;
  const band = (rb: number, t: number) => `M ${-a} 0 A ${a} ${rb} 0 0 ${sweep} ${a} 0 A ${a} ${rb - t} 0 0 ${1 - sweep} ${-a} 0 Z`;
  const add = (attributes: Record<string, string | number>) => {
    const path = document.createElementNS(SVG, "path");
    for (const [name, value] of Object.entries(attributes)) path.setAttribute(name, String(value));
    group.append(path);
    return path;
  };
  const paint = `url(#${id})`;
  const k = front ? 1 : 0.35;
  const o = front ? 1 : 0.5;
  const body = narrow ? 9 : 18;
  const inset = narrow ? 8 : 16;
  add({ d: arc, fill: "none", stroke: paint, "stroke-width": 14, opacity: front ? 0.16 : 0.08, filter: `url(#${id}-soft)` });
  add({ d: arc, fill: "none", stroke: paint, "stroke-width": 1, opacity: 0.85 * o });
  add({ d: band(b, body * k), fill: paint, opacity: 0.06 * o });
  add({ d: band(b, 2.2 * k), fill: paint, opacity: o });
  add({ d: band(b - inset * k, 1.2 * k), fill: paint, opacity: 0.55 * o });
  add({ d: band(b - inset * 0.5 * k, 0.8 * k), fill: paint, opacity: 0.35 * o });
  // The comet's three dashes share a head, so it tapers.
  return [
    [150, 1.2, 0.3],
    [70, 1.8, 0.6],
    [22, 2.6, 1],
  ].map(([length, width, opacity]) => ({
    length,
    path: add({ d: arc, fill: "none", stroke: "#fff1e0", "stroke-width": width, opacity, pathLength: 1000, "stroke-dasharray": `${length} ${2000 - length}`, "stroke-linecap": "round" }),
  }));
}

export function startEarth(canvas: HTMLCanvasElement, ringBack: SVGSVGElement, ringFront: SVGSVGElement, scene: HTMLElement, calm: boolean) {
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: "low-power" });
  let raf = 0;
  let stopped = false;
  let waveAt = -1e9;
  let leaveAt = 0;
  let leaveMs = 1;
  const none = { wave() {}, leave() {}, stop() {} };
  if (!gl) return none;

  let W = 0, H = 0, R = 0, cx = 0, cy = 0, rx = 0, ry = 0;
  const tilt = -0.1;
  let comets: { front: ReturnType<typeof drawRing>; back: ReturnType<typeof drawRing> } | null = null;

  const size = () => {
    W = scene.clientWidth;
    H = scene.clientHeight;
    const narrow = W < 700;
    R = narrow ? Math.min(W * 0.62, H * 0.3) : Math.min(W * 0.225, H * 0.37);
    cx = W / 2;
    cy = narrow ? H - R * 0.72 : H - R * 0.78;
    rx = narrow ? W / 2 + 40 : Math.min(R * 1.94, W / 2 - 60);
    ry = Math.min(rx * (narrow ? 0.3 : 0.13), narrow ? 60 : 1e3);
    const d = Math.min(devicePixelRatio || 1, 1.75);
    canvas.width = Math.round(W * d);
    canvas.height = Math.round(H * d);
    gl.viewport(0, 0, canvas.width, canvas.height);
    const g = R * 1.55;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(Math.max(0, (cx - g) * d), Math.max(0, canvas.height - (cy + g) * d), g * 2 * d, g * 2 * d);
    const transform = `translate(${cx} ${cy}) rotate(${(tilt * 180) / Math.PI})`;
    comets = { back: drawRing(ringBack, rx, ry, false, transform, narrow), front: drawRing(ringFront, rx, ry, true, transform, narrow) };
  };

  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) console.error("Earth shader:", gl.getShaderInfoLog(shader));
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  // Without the planet the question still stands on its sky.
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return none;
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const attribute = gl.getAttribLocation(program, "a");
  gl.enableVertexAttribArray(attribute);
  gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const U = { c: uniform("c"), r: uniform("r"), t: uniform("t"), wv: uniform("wv"), fd: uniform("fd"), L: uniform("L"), rg: uniform("rg") };
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");

  size();
  window.addEventListener("resize", size);

  // The sun comes up: the planet holds as a crescent with its cities lit, then day sweeps across it.
  const LA = [-0.72, 0.5, -0.48];
  const LB = [-0.7, 0.62, 0.3];
  let dawnAt = 0;
  const draw = (now: number) => {
    const d = canvas.width / W;
    const k = clamp01((now - dawnAt - 300) / 3200);
    const e = calm ? 1 : k * k * (3 - 2 * k);
    const light = LA.map((a, i) => a + (LB[i] - a) * e);
    const length = Math.hypot(...light);
    const w = (now - waveAt) / 1800;
    gl.uniform2f(U.c, cx * d, canvas.height - (cy + 40 * (1 - e)) * d);
    gl.uniform1f(U.r, R * d);
    gl.uniform1f(U.t, 18 + (now - dawnAt) / 400);
    gl.uniform3f(U.L, light[0] / length, light[1] / length, light[2] / length);
    gl.uniform3f(U.rg, rx / R, ry / R, tilt);
    gl.uniform1f(U.wv, w > 0 && w < 1 ? w : 0);
    gl.uniform1f(U.fd, (W < 700 ? 56 : 96) * d);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // A lap takes four seconds, much quicker than on the hero: here the spark says work is going on.
  const comet = (now: number) => {
    if (!comets) return;
    const k = (now / 4000) % 1;
    const front = k < 0.5;
    const head = (front ? k * 2 : 1 - (k - 0.5) * 2) * 1000;
    const [on, off] = front ? [comets.front, comets.back] : [comets.back, comets.front];
    for (const dash of off) dash.path.style.visibility = "hidden";
    for (const dash of on) {
      dash.path.style.visibility = "visible";
      dash.path.setAttribute("stroke-dashoffset", (front ? dash.length - head : -head).toFixed(1));
    }
  };

  const loop = (now: number) => {
    if (stopped) return;
    raf = requestAnimationFrame(loop);
    draw(now);
    comet(now);
    // Leaving, the planet sinks away as the sky opens.
    if (leaveAt) {
      const k = clamp01((now - leaveAt) / leaveMs);
      const move = `translate3d(0, ${(k * k * H * 0.22).toFixed(1)}px, 0) scale(${(1 + k * 0.06).toFixed(3)})`;
      canvas.style.transform = move;
      ringBack.style.transform = move;
      ringFront.style.transform = move;
    }
  };

  void Promise.all(
    EARTH_IMAGES.map(async (src, unit) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      if (stopped) return;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
      gl.uniform1i(uniform(["day", "night", "clouds", "water"][unit]), unit);
    }),
  ).then(() => {
    if (stopped) return;
    dawnAt = performance.now();
    scene.dataset.lit = "";
    draw(dawnAt);
    comet(dawnAt);
    if (!calm) raf = requestAnimationFrame(loop);
  });

  return {
    /** A wave of light runs down the planet from the question, lighting the cities it passes. */
    wave() {
      waveAt = performance.now();
    },
    leave(ms: number) {
      leaveMs = ms;
      leaveAt = performance.now();
    },
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", size);
    },
  };
}
