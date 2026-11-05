/**
 * The marketing hero's Earth (marketing/src/components/HomeHero.astro): NASA imagery drawn by a small
 * shader, with day, night, weather and sea glint, and its ring with a spark of light going round.
 * The geometry and the shader match the hero's exactly, so the hero can hand over to this unseen.
 */

const DIR = "/question-stage";
export const EARTH_IMAGES = [`${DIR}/earth-day.avif`, `${DIR}/earth-night.avif`, `${DIR}/earth-clouds.avif`, `${DIR}/earth-water.avif`];
export const SKY_PLATE = `${DIR}/sky-plate.avif`;
/** The planet in daylight at EARTH_PHASE, as the shader draws it, to show before WebGL can start. */
export const EARTH_STILL = `${DIR}/earth-still.avif`;
/** Where the planet has turned to in the still. The hero spins to the same place as it leaves. */
const EARTH_PHASE = 30;
/** How far the still reaches beyond the planet's radius, for its glow. */
export const STILL_REACH = 1.55;

const VERTEX = `#version 300 es\nin vec2 a; void main(){ gl_Position = vec4(a, 0., 1.); }`;
const FRAGMENT = `#version 300 es
precision highp float; out vec4 o; uniform sampler2D day, night, clouds, water; uniform vec2 c; uniform float r, t, tc, sd, wv, fd; uniform vec3 L, rg;
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
  vec2 uv = ll(n, t * .05), uvc = ll(n, tc * .058);
  float wet = texture(water, uv).r; vec3 dc = (texture(day, uv).rgb + wet * vec3(0., .022, .06) + (1. - wet) * vec3(.03, .04, .03)) * vec3(.97, 1., 1.05); vec3 nc = texture(night, uv).rgb; float cl = texture(clouds, uvc).r, sh = texture(clouds, uvc + vec2(.0028, -.0018)).r;
  float dif = dot(n0, L), lit = smoothstep(-.08, .46, dif), dusk = smoothstep(-.14, .08, dif) * (1. - smoothstep(.06, .22, dif));
  vec3 col = dc * (vec3(.05, .075, .13) + 1.12 * lit) * (1. - pow(sh, 1.5) * .3 * lit) + vec3(.012, .032, .085) * (1. - lit);
  col += pow(max(dot(reflect(-L, n0), vec3(0., 0., 1.)), 0.), 90.) * wet * vec3(.7, .85, 1.) * .42 * lit;
  float city = max(nc.r - .05, 0.); col += (nc * 1.1 + city * vec3(1.6, 1.1, .55) * 4.5 * (1. - cl * .8)) * (1. - smoothstep(-.2, .06, dif));
  col = mix(col, mix(vec3(.07, .11, .2), vec3(1., 1., 1.02), lit), pow(cl, 1.5) * .9);
  col += dusk * vec3(.9, .5, .25) * .07;
  col += mix(vec3(.3, .6, .95), vec3(1., .6, .3), smoothstep(.55, .93, sun) * .8) * pow(1. - z, 3.2) * (.24 + .9 * smoothstep(0., .8, dif));
  vec2 q = mat2(cos(rg.z), sin(rg.z), -sin(rg.z), cos(rg.z)) * p; float yr = -rg.y * sqrt(max(0., 1. - q.x * q.x / (rg.x * rg.x))); col *= 1. - .3 * sd * gs((q.y - yr + .035) / .018);
  if (wv > 0.) { float g = acos(clamp(dot(n0, vec3(0., .96, .28)), -1., 1.)), f = wv * 3.2 - .2, e = smoothstep(0., .1, wv) * (1. - wv), b = gs((g - f) / .2) * e; col *= 1. + b * .75; col += b * (vec3(1., .55, .2) * .1 + city * vec3(1.6, 1.15, .6) * 9.) * (1. - cl * .7) + gs((g - f) / .06) * e * vec3(1., .7, .4) * .22 + vec3(1., .72, .42) * pow(1. - z, 2.5) * smoothstep(.1, .9, p.y) * max(0., 1. - wv * 2.) * .6; }
  col = col / (1. + col * .14); float a = 1. - smoothstep(1. - 2.2 / r, 1., d);
  o = (vec4(col, 1.) * a + vec4(h, ha) * (1. - a)) * fade;
}`;

/** The hero's sizes at a width, from its `size()`. */
export function earthLayout(W: number) {
  const [R, rx, k] =
    W >= 1400 ? [320, 620, 0.13] : W >= 1200 ? [250, W / 2 - 60, 0.12] : W >= 1000 ? [260, W / 2 - 60, 0.16] : W >= 700 ? [216, W / 2 - 44, 0.18] : [Math.min(150, W / 2 - 58), W / 2 - 30, 0.3];
  const narrow = W < 700;
  return { R, rx, ry: Math.min(rx * k, narrow ? 60 : 1e3), cx: W / 2, cy: R + (narrow ? 60 : 98), narrow, tilt: -0.1 };
}
type Layout = ReturnType<typeof earthLayout>;

/** The hero's height for its planet at a width, for a visitor who didn't come through the hero. */
export const spaceHeight = (W: number) => (W >= 1400 ? 562 : W >= 1200 ? 478 : W >= 1000 ? 504 : W >= 700 ? 448 : 302);

const COMET: [number, number, number][] = [
  [150, 1.2, 0.3],
  [70, 1.8, 0.6],
  [22, 2.6, 1],
];

/** One half of the ring as the hero draws it, behind the planet or in front of it, as SVG the server can send. */
export function ringMarkup({ rx: a, ry: b, cx, cy, tilt, narrow }: Layout, front: boolean) {
  const id = front ? "stage-ring-front" : "stage-ring-back";
  const sweep = front ? 0 : 1;
  const arc = `M ${-a} 0 A ${a} ${b} 0 0 ${sweep} ${a} 0`;
  const band = (rb: number, t: number) => `M ${-a} 0 A ${a} ${rb} 0 0 ${sweep} ${a} 0 A ${a} ${rb - t} 0 0 ${1 - sweep} ${-a} 0 Z`;
  const paint = `url(#${id})`;
  const fill = (d: string, opacity: number) => `<path d="${d}" fill="${paint}" opacity="${opacity}"/>`;
  const k = front ? 1 : 0.35;
  const o = front ? 1 : 0.5;
  const body = narrow ? 9 : 18;
  const inset = narrow ? 8 : 16;
  return [
    `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${-a}" x2="${a}" y1="0" y2="0"><stop offset="0" stop-color="#ff6b35"/><stop offset=".16" stop-color="#ff9d36"/><stop offset=".34" stop-color="#ffd9ae"/><stop offset=".52" stop-color="#8fd3d8"/><stop offset=".76" stop-color="#5a9be6"/><stop offset="1" stop-color="#3c62b8"/></linearGradient><filter id="${id}-soft" x="-5%" y="-100%" width="110%" height="300%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="9"/></filter></defs>`,
    `<g transform="translate(${cx} ${cy}) rotate(${(tilt * 180) / Math.PI})">`,
    `<path d="${arc}" fill="none" stroke="${paint}" stroke-width="14" opacity="${front ? 0.16 : 0.08}" filter="url(#${id}-soft)"/>`,
    `<path d="${arc}" fill="none" stroke="${paint}" stroke-width="1" opacity="${0.85 * o}"/>`,
    fill(band(b, body * k), 0.06 * o),
    fill(band(b, 2.2 * k), o),
    fill(band(b - inset * k, 1.2 * k), 0.55 * o),
    fill(band(b - inset * 0.5 * k, 0.8 * k), 0.35 * o),
    narrow ? "" : fill(band(b + 7 * k, 0.8 * k), 0.3 * o),
    // The comet's three dashes share a head, so it tapers.
    ...COMET.map(([length, width, opacity]) => `<path data-comet="${length}" d="${arc}" fill="none" stroke="#fff1e0" stroke-width="${width}" opacity="${opacity}" pathLength="1000" stroke-dasharray="${length} ${2000 - length}" stroke-linecap="round" visibility="hidden"/>`),
    `</g>`,
  ].join("");
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Starts the live planet over the still. `onLive` runs once its first frame is drawn. */
export function startEarth(canvas: HTMLCanvasElement, ringBack: SVGSVGElement, ringFront: SVGSVGElement, space: HTMLElement, calm: boolean, onLive: () => void) {
  const none = { wave() {}, stop() {} };
  // Chromium shows a WebGL canvas as white from the moment a page leaves until the next one paints, and nothing
  // can reach the screen by then. So the planet draws off screen and each frame is copied to a plain 2D canvas,
  // which it leaves alone. A browser without WebGL off screen draws straight to the canvas.
  const options: WebGLContextAttributes = { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: "low-power" };
  const offscreen = typeof OffscreenCanvas === "undefined" ? null : new OffscreenCanvas(1, 1).getContext("webgl2", options);
  const gl = offscreen ?? canvas.getContext("webgl2", options);
  if (!gl) return none;
  const buffer = offscreen ? offscreen.canvas : canvas;
  const shown = offscreen ? canvas.getContext("2d") : null;

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
  // Without the planet moving, the still stays where it is.
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return none;
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const attribute = gl.getAttribLocation(program, "a");
  gl.enableVertexAttribArray(attribute);
  gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const U = { c: uniform("c"), r: uniform("r"), t: uniform("t"), tc: uniform("tc"), sd: uniform("sd"), wv: uniform("wv"), fd: uniform("fd"), L: uniform("L"), rg: uniform("rg") };
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");

  let layout = earthLayout(space.clientWidth);
  const size = () => {
    layout = earthLayout(space.clientWidth);
    const d = Math.min(devicePixelRatio || 1, 1.75);
    canvas.width = buffer.width = Math.round(space.clientWidth * d);
    canvas.height = buffer.height = Math.round(space.clientHeight * d);
    gl.viewport(0, 0, canvas.width, canvas.height);
    const g = layout.R * STILL_REACH;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(Math.max(0, (layout.cx - g) * d), Math.max(0, canvas.height - (layout.cy + g) * d), g * 2 * d, g * 2 * d);
  };
  size();
  window.addEventListener("resize", size);

  // The hero's sun once it's fully up.
  const light = [-0.7, 0.62, 0.3];
  const length = Math.hypot(...light);
  let raf = 0;
  let stopped = false;
  let waveAt = -1e9;
  let liveAt = 0;
  let turned = 0;
  let speed = 0;
  let last = 0;

  const draw = (now: number) => {
    const d = canvas.width / space.clientWidth;
    const w = (now - waveAt) / 1800;
    gl.uniform2f(U.c, layout.cx * d, canvas.height - layout.cy * d);
    gl.uniform1f(U.r, layout.R * d);
    gl.uniform1f(U.t, EARTH_PHASE + turned);
    gl.uniform1f(U.tc, EARTH_PHASE + turned);
    // The still has no ring shadow on the planet, so it comes in gently.
    gl.uniform1f(U.sd, liveAt ? clamp01((now - liveAt) / 900) : 0);
    gl.uniform3f(U.L, light[0] / length, light[1] / length, light[2] / length);
    gl.uniform3f(U.rg, layout.rx / layout.R, layout.ry / layout.R, layout.tilt);
    gl.uniform1f(U.wv, w > 0 && w < 1 ? w : 0);
    gl.uniform1f(U.fd, (layout.narrow ? 56 : 96) * d);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (shown) {
      shown.clearRect(0, 0, canvas.width, canvas.height);
      shown.drawImage(buffer, 0, 0);
    }
  };

  const cometsFront = [...ringFront.querySelectorAll<SVGPathElement>("[data-comet]")];
  const cometsBack = [...ringBack.querySelectorAll<SVGPathElement>("[data-comet]")];
  // A lap takes four seconds, much quicker than on the hero: here the spark says work is going on.
  const comet = (now: number) => {
    // It swings round the far ends of the ring and hurries across the front, as an orbit does.
    const lap = ((now - liveAt) / 4000) % 1;
    const k = (lap + 0.07 * Math.sin(lap * 2 * Math.PI) + 1) % 1;
    const front = k < 0.5;
    const head = (front ? k * 2 : 1 - (k - 0.5) * 2) * 1000;
    for (const dash of front ? cometsBack : cometsFront) dash.setAttribute("visibility", "hidden");
    for (const dash of front ? cometsFront : cometsBack) {
      const dashLength = Number(dash.dataset.comet);
      dash.setAttribute("visibility", "visible");
      dash.setAttribute("stroke-dashoffset", (front ? dashLength - head : -head).toFixed(1));
    }
  };

  const loop = (now: number) => {
    if (stopped) return;
    raf = requestAnimationFrame(loop);
    // It starts from rest, as the still is, and gathers speed.
    const dt = Math.min(64, now - last);
    last = now;
    speed += (2.5 - speed) * (1 - Math.exp(-dt / 900));
    turned += (speed * dt) / 1000;
    draw(now);
    comet(now);
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
  ).then(
    () => {
      if (stopped || calm) return;
      liveAt = last = performance.now();
      draw(liveAt);
      onLive();
      raf = requestAnimationFrame(loop);
    },
    // An image that won't load leaves the still where it is.
    (error) => console.error("Earth images:", error),
  );

  return {
    /** A wave of light runs down the planet from the question, lighting the cities it passes. */
    wave() {
      waveAt = performance.now();
    },
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", size);
    },
  };
}
