// The marketing hero's Earth (marketing/src/components/HomeHero.astro): NASA imagery drawn by a small shader, with day,
// night, weather and sea glint, and its ring with a spark of light going round. A plain script of its own, so it can start
// as soon as the stage reaches the browser: waiting for the app's scripts would leave the planet standing still.
(function () {
  var DIR = "/question-stage/earth-";
  var IMAGES = ["day", "night", "clouds", "water"];
  var VERTEX = `#version 300 es\nin vec2 a; void main(){ gl_Position = vec4(a, 0., 1.); }`;
  var FRAGMENT = `#version 300 es
precision highp float; out vec4 o; uniform sampler2D day, night, clouds, water; uniform vec2 c; uniform float r, t, sd, wv, fd; uniform vec3 L, rg;
const float PI = 3.14159265;
float gs(float x){ return exp(-x * x); }
vec2 ll(vec3 n, float spin, out vec2 gx, out vec2 gy){ float lon = atan(n.x, n.z) - spin, lat = asin(clamp(n.y, -1., 1.)), u = lon / (2. * PI), v = .5 - lat / PI; float u1 = fract(u), u2 = fract(u + .5) - .5, x1 = dFdx(u1), x2 = dFdx(u2), y1 = dFdy(u1), y2 = dFdy(u2); gx = vec2(abs(x1) < abs(x2) ? x1 : x2, dFdx(v)); gy = vec2(abs(y1) < abs(y2) ? y1 : y2, dFdy(v)); return vec2(u1, v); }
vec3 halo(float d, float sun){ float lit = smoothstep(-.55, .75, sun), e = max(d - 1., 0.), g = (exp(-e * 22.) * .7 + exp(-e * 5.) * .08) * (1. - smoothstep(1.2, 1.5, d)); return mix(mix(vec3(.06, .16, .42), vec3(.36, .62, .95), lit), vec3(1., .56, .24), smoothstep(.5, .93, sun) * .8) * g * (.42 + lit) + vec3(1., .68, .36) * smoothstep(.55, .92, sun) * exp(-e * 26.) + vec3(1., .92, .8) * smoothstep(.82, .95, sun) * exp(-e * 70.) * .7; }
void main(){
  vec2 p = (gl_FragCoord.xy - c) / r; float d = length(p), sun = dot(normalize(vec3(p, .001)), L); vec3 h = halo(d, sun);
  if (wv > 0.) h *= 1. + 1.6 * smoothstep(0., .08, wv) * max(0., 1. - wv * 2.) * smoothstep(.1, .9, p.y);
  float ha = clamp(max(h.r, max(h.g, h.b)), 0., 1.);
  float fade = smoothstep(0., fd, gl_FragCoord.y); if (d > 1.) { o = vec4(h, ha) * fade; return; }
  float z = sqrt(1. - d * d); vec3 n0 = vec3(p, z);
  float ax = .4, ay = .22; mat3 lean = mat3(cos(ax), sin(ax), 0., -sin(ax), cos(ax), 0., 0., 0., 1.) * mat3(1., 0., 0., 0., cos(ay), -sin(ay), 0., sin(ay), cos(ay)); vec3 n = lean * n0;
  vec2 gx, gy, gxc, gyc, uv = ll(n, t * .05, gx, gy), uvc = ll(n, t * .058, gxc, gyc);
  #ifdef LIGHT
  float wet = 0.;
  #else
  float wet = textureGrad(water, uv, gx, gy).r;
  #endif
 vec3 dc = (textureGrad(day, uv, gx, gy).rgb + wet * vec3(0., .022, .06) + (1. - wet) * vec3(.03, .04, .03)) * vec3(.97, 1., 1.05); vec3 nc = textureGrad(night, uv, gx, gy).rgb; float cl = textureGrad(clouds, uvc, gxc, gyc).r;
  #ifdef LIGHT
  float sh = 0.;
  #else
  float sh = textureGrad(clouds, uvc + vec2(.0028, -.0018), gxc, gyc).r;
  #endif

  float dif = dot(n0, L), lit = smoothstep(-.08, .46, dif), dusk = smoothstep(-.14, .08, dif) * (1. - smoothstep(.06, .22, dif));
  vec3 col = dc * (vec3(.05, .075, .13) + 1.12 * lit) * (1. - pow(sh, 1.5) * .3 * lit) + vec3(.012, .032, .085) * (1. - lit);
  #ifndef LIGHT
  col += pow(max(dot(reflect(-L, n0), vec3(0., 0., 1.)), 0.), 90.) * wet * vec3(.7, .85, 1.) * .42 * lit;
  #endif

  float city = max(nc.r - .05, 0.); col += (nc * 1.1 + city * vec3(1.6, 1.1, .55) * 4.5 * (1. - cl * .8)) * (1. - smoothstep(-.2, .06, dif));
  col = mix(col, mix(vec3(.07, .11, .2), vec3(1., 1., 1.02), lit), pow(cl, 1.5) * .9);
  col += dusk * vec3(.9, .5, .25) * .07;
  col += mix(vec3(.3, .6, .95), vec3(1., .6, .3), smoothstep(.55, .93, sun) * .8) * pow(1. - z, 3.2) * (.24 + .9 * smoothstep(0., .8, dif));
  vec2 q = mat2(cos(rg.z), sin(rg.z), -sin(rg.z), cos(rg.z)) * p; float yr = -rg.y * sqrt(max(0., 1. - q.x * q.x / (rg.x * rg.x))); col *= 1. - .3 * sd * gs((q.y - yr + .035) / .018);
  if (wv > 0.) { float g = acos(clamp(dot(n0, vec3(0., .96, .28)), -1., 1.)), f = wv * 3.2 - .2, e = smoothstep(0., .1, wv) * (1. - wv), b = gs((g - f) / .2) * e; col *= 1. + b * .75; col += b * (vec3(1., .55, .2) * .1 + city * vec3(1.6, 1.15, .6) * 9.) * (1. - cl * .7) + gs((g - f) / .06) * e * vec3(1., .7, .4) * .22 + vec3(1., .72, .42) * pow(1. - z, 2.5) * smoothstep(.1, .9, p.y) * max(0., 1. - wv * 2.) * .6; }
  col = col / (1. + col * .14); float a = 1. - smoothstep(1. - 2.2 / r, 1., d);
  o = (vec4(col, 1.) * a + vec4(h, ha) * (1. - a)) * fade;
}`;
  // The hero's sun once it's fully up, and just behind the planet's top edge: there the globe is in shadow with its cities
  // on, under a bright crescent.
  var SUN_UP = [-0.7, 0.62, 0.3];
  var SUN_BEHIND = [0, 0.85, -0.52];
  // Turns a second, in the shader's units. The hero's speed, easing up a little once it has gone.
  var CRUISE = 1.6;
  var PHASE_STILL = 30;
  // A planet that drops to level 0 after drawing stops where it is, drawn once at this level; the hero hands that turn on.
  var FROZEN_LEVEL = 2;
  var smooth = function (t) { return t * t * (3 - 2 * t); };
  var clamp01 = function (v) { return Math.min(1, Math.max(0, v)); };
  var unit = function (v) { var l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };

  // Diagnostics for the app's stage only, so the marketing page's console stays quiet.
  var log = function () { if (document.documentElement.dataset.questionStage !== undefined) console.info.apply(console, arguments); };

  var OPTIONS = { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: "low-power" };

  // The quality ladder, cheapest first. Level 0 is the still image. Each step up costs a real amount more: measured on
  // Chromium's software renderer a frame of the light shader at 1x took 8 ms, the full shader at 1x 22 ms, and at 2x 83 ms
  // (docs/research/device-performance.md).
  var LEVELS = [
    null,
    { lite: true, scale: 0.75, every: 2 },
    { lite: true, scale: 1, every: 1 },
    { lite: false, scale: 1, every: 1 },
    { lite: false, scale: 1.5, every: 1 },
    { lite: false, scale: 2, every: 1 },
  ];
  var TOP = LEVELS.length - 1;

  /**
   * Where to start before anything has been measured: what was remembered, else what the browser lets on. The monitor then
   * moves it up or down from what it sees.
   */
  function startLevel(remembered) {
    if (remembered >= 0 && remembered <= TOP) return remembered;
    var connection = navigator.connection;
    if (connection && (connection.saveData || /(^|-)2g$/.test(connection.effectiveType || ""))) return 0;
    var memory = navigator.deviceMemory, cores = navigator.hardwareConcurrency || 8;
    // A context that refuses to be made when performance would be poor means software rendering or a blocklisted GPU.
    var probe = document.createElement("canvas").getContext("webgl2", { failIfMajorPerformanceCaveat: true });
    if (!probe) return 1;
    // The GPU's name. Firefox gives it as the renderer; Chromium masks that and gives it through the extension.
    var name = String(probe.getParameter(probe.RENDERER));
    var info = /^webkit webgl$/i.test(name) && probe.getExtension("WEBGL_debug_renderer_info");
    if (info) name = String(probe.getParameter(info.UNMASKED_RENDERER_WEBGL));
    var lose = probe.getExtension("WEBGL_lose_context");
    if (lose) lose.loseContext();
    // A software renderer by name: the planet draws on the CPU there, and only the light level keeps up.
    if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(name)) return 1;
    // Old GPUs by name, from the list Stripe's home page ships (read 2026-11-05): these start on the light level. Any other
    // GPU is taken to be capable, as Stripe does, and the monitor corrects a wrong guess within a couple of seconds. The
    // older GeForce GT and Intel HD parts are added to Stripe's list.
    if (/powervr sgx|powervr series ?[4-6]|adreno \(?tm\)? ?(2\d\d|3\d\d|4\d\d|50[0-6])\b|mali-(2|3|4)\d\d|mali-t[678]\d\d|mali-g(31|51)\b|intel.*(gma|g4[15]|q45|hd graphics [234]000|hd graphics 2500)|geforce (8|9)\d{3}|geforce gt [1-7]\d\d(?!\d)|radeon hd [2-5]\d{3}/i.test(name)) return 1;
    if ((memory && memory <= 2) || cores <= 2) return 1;
    if ((memory && memory <= 4) || cores <= 4) return 3;
    return 4;
  }

  /**
   * Watches the frame rate the way drei's PerformanceMonitor does (pmndrs/drei): averages over 250 ms, ten of them, and a
   * move when three in four agree, against drei's fixed bounds (hold 60 on a 120 Hz screen, else 40). Fixed, because bounds
   * taken from the frame rate it's judging would excuse a device that was slow from its first frame. In WebKit a steady 30
   * is the Low Power Mode cap, not the planet, so it holds there. After three changes of direction it stays where it is.
   */
  // Only WebKit caps frames for Low Power Mode, and on iOS every browser is WebKit. Elsewhere a steady 30 is just slow.
  var CAPPED_AT_30 = /AppleWebKit/.test(navigator.userAgent) && !/Chrome\//.test(navigator.userAgent);
  function monitor(onMove) {
    var windowStart = 0, frames = 0, averages = [], refresh = 0, turns = 0, lastMove = 0, settled = false;
    return function (now, level, ceiling) {
      if (settled) return;
      // A window that spans a pause (the page hidden or scrolled away, or back from another page) says nothing of speed.
      if (!windowStart || now - windowStart > 1000) { windowStart = now; frames = 0; return; }
      frames++;
      if (now - windowStart < 250) return;
      var fps = (frames * 1000) / (now - windowStart);
      windowStart = now; frames = 0;
      refresh = Math.max(refresh, fps);
      averages.push(fps);
      if (averages.length > 10) averages.shift();
      // The upper bound is a touch lenient, as a 60 Hz screen measures just under 60.
      var lower = refresh > 100 ? 60 : 40, upper = refresh > 100 ? 95 : 57;
      var recent = averages.slice(-4);
      var capped = CAPPED_AT_30 && recent.length === 4 && recent.every(function (a) { return Math.abs(a - 30) < 3; });
      // Far too slow drops sooner and further: a second of frames at under half the lower bound is enough to go down two.
      var drowning = recent.length === 4 && recent.every(function (a) { return a < lower / 2; });
      var low = averages.filter(function (a) { return a < lower; }).length, high = averages.filter(function (a) { return a >= upper; }).length;
      var move = capped ? 0 : drowning ? -2 : averages.length < 10 ? 0 : low > 7 ? -1 : high > 7 && level < ceiling ? 1 : 0;
      if (!move) return;
      if (lastMove && Math.sign(move) !== Math.sign(lastMove)) turns++;
      lastMove = move;
      averages = [];
      if (turns >= 3) { settled = true; if (move > 0) return; }
      if (level + move < 1 && level > 1) move = 1 - level;
      onMove(Math.max(0, Math.min(ceiling, level + move)));
    };
  }

  /**
   * Starts compiling the shader for the light levels or the full ones (`light`), and uploads the four maps. Coming from the
   * hero this runs while the new page is still arriving, so the planet's first frame can be drawn the moment the stage is
   * there. `canvas` is only for a browser without WebGL off screen, which has to draw straight to the canvas on the page.
   */
  var prepared = null;
  function prepare(canvas, light, base) {
    base = base || DIR;
    if (prepared && prepared.base === base && (prepared.offscreen || prepared.canvas === canvas)) return prepared;
    // Chromium shows a WebGL canvas as white from the moment a page leaves until the next one paints, and nothing can
    // reach the screen by then. So the planet draws off screen and each frame is copied to a plain 2D canvas.
    var gl = typeof OffscreenCanvas === "undefined" ? null : new OffscreenCanvas(1, 1).getContext("webgl2", OPTIONS);
    var offscreen = !!gl;
    if (!gl && canvas) gl = canvas.getContext("webgl2", OPTIONS);
    if (!gl) return null;
    var compile = function (type, source) {
      var shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    };
    var triangle = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, triangle);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    // Where the browser can, the shaders compile off the main thread, and the page is asked about them only once they're done:
    // asking sooner waits for the compile, which on a weak GPU holds up the whole page.
    var parallel = gl.getExtension("KHR_parallel_shader_compile");
    var programs = {};
    // The full shader, or the light one without the cloud shadow and sea glint. Each starts compiling the first time it's
    // wanted, so a device on the light levels never compiles the full one.
    var begin = function (lite) {
      var key = lite ? "lite" : "full";
      if (!programs[key]) {
        var made = gl.createProgram(), vertex = compile(gl.VERTEX_SHADER, VERTEX), fragment = compile(gl.FRAGMENT_SHADER, lite ? FRAGMENT.replace("precision highp float;", "precision highp float;\n#define LIGHT\n") : FRAGMENT);
        gl.attachShader(made, vertex);
        gl.attachShader(made, fragment);
        gl.linkProgram(made);
        programs[key] = { made: made, fragment: fragment, built: undefined };
      }
      return programs[key];
    };
    // The program ready to draw with, or null if it failed. Asked before the compile is done, this waits for it.
    var program = function (lite) {
      var entry = begin(lite);
      if (entry.built !== undefined) return entry.built;
      var made = entry.made;
      if (!gl.getProgramParameter(made, gl.LINK_STATUS)) {
        console.error("[earth] shader:", gl.getShaderInfoLog(entry.fragment) || gl.getProgramInfoLog(made));
        return (entry.built = null);
      }
      gl.useProgram(made);
      var attribute = gl.getAttribLocation(made, "a");
      gl.enableVertexAttribArray(attribute);
      gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
      var u = function (name) { return gl.getUniformLocation(made, name); };
      IMAGES.forEach(function (name, i) { gl.uniform1i(u(name), i); });
      return (entry.built = { program: made, U: { c: u("c"), r: u("r"), t: u("t"), sd: u("sd"), wv: u("wv"), fd: u("fd"), L: u("L"), rg: u("rg") } });
    };
    // Settles once a program can be asked about without waiting.
    var compiled = function (lite) {
      var entry = begin(lite);
      return new Promise(function (done) {
        var poll = function () { if (!parallel || gl.getProgramParameter(entry.made, parallel.COMPLETION_STATUS_KHR)) done(); else setTimeout(poll, 16); };
        poll();
      });
    };
    var aniso = gl.getExtension("EXT_texture_filter_anisotropic");
    var self = {
      gl: gl, offscreen: offscreen, canvas: offscreen ? null : canvas, loaded: false, program: program, compiled: compiled, base: base,
    };
    var maps = [];
    var upload = function (i, image) {
      gl.activeTexture(gl.TEXTURE0 + i);
      if (maps[i]) gl.deleteTexture(maps[i]);
      gl.bindTexture(gl.TEXTURE_2D, (maps[i] = gl.createTexture()));
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    };
    var fetchMap = function (name) {
      var image = new Image();
      image.src = base + name + ".avif";
      return image.decode().then(function () { return image; });
    };
    // Every device starts on the smaller day map, a third of the bytes, so the planet is there sooner on a slow connection.
    // The full levels then swap in the sharp one once it has arrived.
    self.textures = Promise.all(IMAGES.map(function (name, i) {
      return fetchMap(name === "day" ? "day-2048" : name).then(function (image) { upload(i, image); });
    })).then(function () {
      self.loaded = true;
      log("[earth] maps ready at", Math.round(performance.now()) + "ms");
      if (!light) fetchMap("day").then(function (image) { if (!gl.isContextLost()) upload(0, image); }, function () {});
    });
    begin(light);
    log("[earth] context ready at", Math.round(performance.now()) + "ms");
    // A lost context (a GPU reset, or the browser reclaiming it) can't draw again: whoever drew with it falls back to the
    // still, and the next start makes a new one.
    var lost = [];
    self.onLost = function (callback) { lost.push(callback); };
    gl.canvas.addEventListener("webglcontextlost", function () {
      if (prepared === self) prepared = null;
      lost.forEach(function (callback) { callback(); });
    });
    prepared = self;
    return self;
  }

  /**
   * The ring's spark of light. A lap takes four seconds, much quicker than on the hero: here it says work is going on. It
   * swings round the far ends of the ring and hurries across the front, as an orbit does. Its tail is a chain of short
   * segments, each laid along the ring where it is, so it follows the curve: one straight streak left a phone's tight ring.
   * Everything moves by transform alone.
   */
  function spark(stage, layout, lapMs) {
    lapMs = lapMs || 4000;
    // The page renders the segments, the same number in front of the planet and behind it, head first.
    var chains = { front: stage.querySelectorAll("[data-spark=front]"), back: stage.querySelectorAll("[data-spark=back]") };
    var count = Math.min(chains.front.length, chains.back.length);
    if (!count) return function () {};
    // The tail is 150 px on a wide ring and shorter on a narrow one, so it never covers more than a stretch of the curve.
    var tail = Math.min(150, layout.rx * 0.6), step = tail / count;
    // Brightest at the head, fading along the tail. Each segment runs from the brightness at its tail end to the one at its
    // head end, so the joins don't show and only opacity changes as it moves.
    var fall = function (i) { return Math.pow(Math.max(0, 1 - i / count), 1.6).toFixed(3); };
    ["front", "back"].forEach(function (side) {
      for (var i = 0; i < count; i++) {
        var segment = chains[side][i];
        segment.style.width = (step + 0.6).toFixed(1) + "px";
        segment.style.borderRadius = i === 0 ? "0 2px 2px 0" : "0";
        segment.style.background = "linear-gradient(90deg, rgb(255 241 224 / " + fall(i + 1) + "), rgb(255 241 224 / " + fall(i) + "))";
        segment.style.opacity = "0";
      }
    });
    var c = Math.cos(layout.tilt), s = Math.sin(layout.tilt);
    // The ring at an angle: where it is, which way it runs (in the direction of travel), and how far a step of angle goes.
    var at = function (angle) {
      var ox = layout.rx * Math.cos(angle), oy = layout.ry * Math.sin(angle);
      var dx = layout.rx * Math.sin(angle), dy = -layout.ry * Math.cos(angle);
      return { x: layout.cx + ox * c - oy * s, y: layout.cy + ox * s + oy * c, front: oy > 0, heading: Math.atan2(dx * s + dy * c, dx * c - dy * s), speed: Math.hypot(dx, dy), ends: Math.min(1, Math.abs(Math.sin(angle)) * 4) };
    };
    return function (elapsed) {
      var lap = (elapsed / lapMs) % 1;
      var k = (lap + 0.07 * Math.sin(lap * 2 * Math.PI) + 1) % 1;
      // Left to right across the front, then back again behind the planet.
      var angle = k < 0.5 ? Math.PI - k * 2 * Math.PI : -(k - 0.5) * 2 * Math.PI;
      for (var i = 0; i < count; i++) {
        var p = at(angle), shown = p.front ? chains.front[i] : chains.back[i], hidden = p.front ? chains.back[i] : chains.front[i];
        hidden.style.opacity = "0";
        // Half as bright behind the planet, and gone at the far ends.
        shown.style.opacity = ((p.front ? 1 : 0.5) * p.ends).toFixed(3);
        shown.style.transform = "translate(" + (p.x - step - 0.6).toFixed(1) + "px," + p.y.toFixed(1) + "px) rotate(" + p.heading.toFixed(3) + "rad)";
        // The next segment starts where this one ends, a step back along the ring.
        angle += step / Math.max(1, p.speed);
      }
    };
  }

  /** The still level: no WebGL at all, only the ring's spark going round, at 30 frames a second. */
  function still(o) {
    var comet = spark(o.stage, o.layout), raf = 0, stopped = false, began = performance.now(), last = 0;
    var loop = function (now) {
      if (stopped || (o.stage && !o.stage.isConnected)) return;
      raf = requestAnimationFrame(loop);
      if (now - last < 32) return;
      last = now;
      comet(now - began);
    };
    if (!o.calm) raf = requestAnimationFrame(loop);
    return { wave: function () {}, sunBehind: function () {}, stop: function () { stopped = true; cancelAnimationFrame(raf); }, level: 0 };
  }

  /**
   * The planet's drawing, on its own: a canvas at a quality level, drawn one frame at a time from the values given. The
   * stage below and the marketing hero (marketing/src/components/HomeHero.astro) both use it, so the two are the same
   * planet. `base` is where the four maps are served from.
   */
  function renderer(o) {
    var canvas = o.canvas, layout = o.layout, width = o.width, height = o.height;
    var level = Math.max(1, Math.min(TOP, o.level));
    var ready = prepare(canvas, level <= 2, o.base);
    if (!ready) return null;
    if (o.onLost) ready.onLost(o.onLost);
    var gl = ready.gl;
    var buffer = ready.offscreen ? gl.canvas : canvas;
    var shown = ready.offscreen ? canvas.getContext("2d") : null;
    var spec, current, d;
    // Sets the drawing up for a level and a size: its shader, its resolution and how often it draws. The shader is taken at
    // the next frame, so setting up never waits for a compile.
    var apply = function () {
      spec = LEVELS[level];
      current = null;
      d = Math.min((devicePixelRatio || 1) * (o.zoom || 1), spec.scale);
      canvas.width = buffer.width = Math.round(width * d);
      canvas.height = buffer.height = Math.round(height * d);
      gl.viewport(0, 0, canvas.width, canvas.height);
      var g = layout.R * 1.55;
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(Math.max(0, (layout.cx - g) * d), Math.max(0, canvas.height - (layout.cy + g) * d), g * 2 * d, g * 2 * d);
    };
    apply();
    // Ready once the maps are in and the shader has compiled. It fails if neither shader can be built, with `shader` set, so a
    // caller can show the still for that and not for a map that failed to arrive.
    var textures = Promise.all([ready.textures, ready.compiled(spec.lite)]).then(function () {
      if (ready.program(spec.lite) || ready.program(!spec.lite)) return;
      var error = new Error("no shader");
      error.shader = true;
      throw error;
    });
    return {
      textures: textures,
      get loaded() { return ready.loaded; },
      get level() { return level; },
      /** How many display frames apart this level draws. */
      get every() { return spec.every; },
      setLevel: function (next) { level = Math.max(1, Math.min(TOP, next)); apply(); },
      resize: function (w, h, l) { width = w; height = h; layout = l; apply(); },
      /** One frame: `t` the turn, `sun` a unit vector, `shadow` the ring's shadow on it, `wave` 0 to 1 or 0, `lift` px. */
      draw: function (u) {
        current = current || ready.program(spec.lite) || ready.program(!spec.lite);
        if (!current) return false;
        var U = current.U;
        gl.useProgram(current.program);
        gl.uniform2f(U.c, layout.cx * d, canvas.height - (layout.cy + (u.lift || 0)) * d);
        gl.uniform1f(U.r, layout.R * d);
        gl.uniform1f(U.t, u.t);
        gl.uniform1f(U.sd, u.shadow);
        gl.uniform3f(U.L, u.sun[0], u.sun[1], u.sun[2]);
        gl.uniform3f(U.rg, layout.rx / layout.R, layout.ry / layout.R, layout.tilt);
        gl.uniform1f(U.wv, u.wave || 0);
        gl.uniform1f(U.fd, (layout.narrow ? 56 : 96) * d);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (shown) {
          shown.clearRect(0, 0, canvas.width, canvas.height);
          shown.drawImage(buffer, 0, 0);
        }
        return true;
      },
    };
  }

  /**
   * Starts the planet. `turn` is where the hero had got to and when, so that it carries on as if nothing had happened;
   * without one it starts from the still's place, at rest. `ready` runs once its first frame is drawn, or it can't be.
   */
  function start(o) {
    var canvas = o.canvas, layout = o.layout, turn = o.turn;
    var none = { wave: function () {}, sunBehind: function () {}, stop: function () {}, level: 0 };
    var planet = renderer({ canvas: canvas, layout: layout, width: o.width, height: o.height, level: o.level, zoom: o.zoom, onLost: function () { level = 0; if (o.stage) delete o.stage.dataset.frozen; o.onLevel(0); } });
    if (!planet) { o.ready(false); return none; }
    var level = planet.level, frameNo = 0, lastDrawn = 0;

    var raf = 0, stopped = false, waveAt = -1e9, liveAt = 0, sunAt = 0, sunMs = 1, last = 0;
    var phase = turn ? turn.t : PHASE_STILL;
    var speed = turn && !o.frozen ? 1 : 0;

    var draw = function (now) {
      var w = (now - waveAt) / 1800;
      var swing = sunAt ? smooth(clamp01((now - sunAt) / sunMs)) : 0;
      var from = unit(SUN_UP);
      return planet.draw({
        t: phase,
        sun: unit([from[0] + (SUN_BEHIND[0] - from[0]) * swing, from[1] + (SUN_BEHIND[1] - from[1]) * swing, from[2] + (SUN_BEHIND[2] - from[2]) * swing]),
        // The still has no ring shadow on the planet, so coming from it, it comes in gently.
        shadow: turn || !liveAt ? (turn ? 1 : 0) : clamp01((now - liveAt) / 900),
        wave: w > 0 && w < 1 ? w : 0,
      });
    };

    var comet = spark(o.stage, layout);

    // Down to level 0 the planet stops where it is, drawn once more at the light level's full resolution, as the hero's does,
    // and the ring's spark keeps going so the page doesn't look stuck.
    var watch = monitor(function (next) {
      log("[earth] level", level, "to", next);
      if (next === 0) { planet.setLevel(FROZEN_LEVEL); draw(performance.now()); level = 0; if (o.stage) o.stage.dataset.frozen = ""; o.onLevel(0); return; }
      level = next;
      planet.setLevel(level);
      o.onLevel(level);
    });
    var loop = function (now) {
      // A stage taken off the page before it finished stops with it.
      if (stopped || (o.stage && !o.stage.isConnected && liveAt && now - liveAt > 2000)) return;
      raf = requestAnimationFrame(loop);
      var dt = Math.min(64, now - last);
      last = now;
      if (!o.frozen) speed += (CRUISE - speed) * (1 - Math.exp(-dt / 2000));
      phase += (speed * dt) / 1000;
      // The first second after it starts is the page still settling, so the monitor waits it out. The still is final.
      if (level > 0 && now - liveAt > 1000) watch(now, level, TOP);
      comet(now - liveAt);
      // At most 60 planet frames a second, even on a 120 Hz screen: a slow turn looks the same, for half the work. Stripe's
      // globe draws every other frame for the same reason.
      if (level === 0 || now - lastDrawn < 1000 / 60 - 2 || frameNo++ % planet.every) return;
      lastDrawn = now;
      draw(now);
    };

    var go = function () {
      if (stopped) return;
      // Carries on from where the hero stood still: it stops drawing once this page's response starts arriving, and the
      // screen holds its last frame until this one is ready. Jumping to where it would be now would jolt it forward.
      if (turn && !o.frozen) {
        var entry = performance.getEntriesByType("navigation")[0];
        var froze = entry && entry.responseStart ? performance.timeOrigin + entry.responseStart : Date.now();
        phase = turn.t + Math.min(30, Math.max(0, (froze - turn.at) / 1000));
      }
      liveAt = last = performance.now();
      // Neither shader built: the still stands in.
      if (!draw(liveAt)) { o.ready(false); return; }
      // Frozen, it's drawn once and only the ring's spark moves on.
      if (o.frozen) level = 0;
      o.ready(true);
      if (!o.calm) raf = requestAnimationFrame(loop);
    };
    // Ready already, it draws now, before the browser paints the stage for the first time.
    if (planet.loaded) { planet.textures.catch(function () {}); go(); }
    else planet.textures.then(go, function (error) {
      console.error("[earth] images:", error);
      o.ready(false);
    });

    return {
      /** A wave of light runs down the planet from the question, lighting the cities it passes. */
      wave: function () { waveAt = performance.now(); },
      /** Swings the sun round behind the planet. */
      sunBehind: function (ms) { sunMs = ms; sunAt = performance.now(); },
      stop: function () { stopped = true; cancelAnimationFrame(raf); },
      get level() { return level; },
    };
  }

  // The browser has been told not to paint until a stylesheet has loaded: removing it lets the page paint now, with the
  // planet in it (lib/search/question-stage-script.ts).
  var release = function () {
    var hold = document.getElementById("question-stage-hold");
    if (hold) hold.remove();
  };
  // The level this device ended up at, kept for the visit only: a level saved for good would stick after one stall at load.
  // None of the WebGL home pages studied saves it (docs/research/device-performance.md).
  var MEMORY = "openscholar.planet-level";

  /**
   * Starts the planet in a stage, reading its settings from the stage's data-earth-config, unless it's already going
   * there. The app calls this too, so a stage React has built itself still gets its planet.
   */
  function boot(stage) {
    var canvas = stage.querySelector("canvas");
    var image = stage.querySelector("[data-still]");
    var running = window.questionStageEarthRun;
    if (running && running.canvas === canvas) return running;
    if (running) running.stop();
    var config = JSON.parse(stage.dataset.earthConfig);
    if (config.level == null) {
      var remembered = -1;
      try { remembered = Number(sessionStorage.getItem(MEMORY) ?? -1); } catch (error) {}
      config.level = startLevel(remembered);
    }
    stage.dataset.level = String(config.level);
    // Level 0 handed over with the hero's own turn: the hero's planet had stopped where it was, so this draws that same
    // view once instead of showing the still, which faces another way.
    var frozen = config.level === 0 && config.turn && config.turn.t !== PHASE_STILL;
    if (frozen) stage.dataset.frozen = "";
    // Otherwise level 0 never starts WebGL: the still is the planet, and only the ring's spark moves.
    if (config.level === 0 && !frozen) {
      // The page paints once the still can be drawn, so the planet's place is never empty.
      var picture = image.querySelector("img");
      (picture ? picture.decode() : Promise.resolve()).then(release, release);
      var resting = still({ stage: stage, layout: config.layout, calm: matchMedia("(prefers-reduced-motion: reduce)").matches });
      resting.canvas = canvas;
      window.questionStageEarthRun = resting;
      return resting;
    }
    log("[earth] stage arrived at", Math.round(performance.now()) + "ms");
    var begun = performance.now();
    log("[earth] starting", config.turn ? "from the hero" : "from rest");
    var run = start({
      stage: stage, canvas: canvas,
      layout: config.layout, width: config.width, height: config.height, turn: config.turn,
      level: frozen ? FROZEN_LEVEL : config.level, frozen: frozen,
      // Coming from the hero the stage is scaled to this page's zoom, so the canvas needs that many more pixels to stay sharp.
      zoom: config.turn ? window.innerWidth / config.width : 1,
      onLevel: function (level) {
        stage.dataset.level = String(level);
        try { sessionStorage.setItem(MEMORY, String(level)); } catch (error) {}
      },
      calm: matchMedia("(prefers-reduced-motion: reduce)").matches,
      ready: function (ok) {
        log("[earth]", ok ? "drawing" : "can't draw, showing the still", Math.round(performance.now() - begun) + "ms after starting");
        if (ok) { canvas.dataset.live = ""; image.dataset.live = ""; release(); return; }
        image.dataset.failed = "";
        // Under a live planet from the hero the still waited to be needed: it's fetched now, and the page paints once it can
        // be drawn, so the planet's place is never empty.
        var picture = image.querySelector("img");
        if (picture) picture.loading = "eager";
        (picture ? picture.decode() : Promise.resolve()).then(release, release);
      },
    });
    run.canvas = canvas;
    window.questionStageEarthRun = run;
    return run;
  }

  // Loaded early by the page's first script (lib/search/question-stage-script.ts), it gets the planet ready while the page is
  // still arriving, and starts it the moment the stage is there, before the app's own scripts.
  log("[earth] script ran at", Math.round(performance.now()) + "ms");
  // Coming from the hero, the maps are fetched and the shader for its level starts compiling now, unless the hero had come
  // to rest on the still (its level is the 8th number).
  var handed = new URLSearchParams(location.search).get("hero");
  var handedNumbers = handed ? handed.split(",").map(Number) : [];
  var handedLevel = handedNumbers[7] || 0;
  if (handedLevel > 0 || (handed && handedNumbers[5] !== PHASE_STILL)) prepare(null, handedLevel <= 2);
  // The page arrives in pieces, so it waits for the stage's last part, the ring in front, before starting.
  var find = function () {
    var stage = document.querySelector("#question-stage[data-earth-config]");
    if (!stage || !stage.querySelector("[data-ring=front]")) return false;
    try { boot(stage); } catch (error) { console.error("[earth] couldn't start:", error); }
    return true;
  };
  if (document.documentElement.dataset.questionStage !== undefined && !find()) {
    var watching = new MutationObserver(function () { if (find()) watching.disconnect(); });
    watching.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(function () { watching.disconnect(); }, 20000);
  }

  window.questionStageEarth = { boot: boot, renderer: renderer, monitor: monitor, spark: spark, startLevel: startLevel, memory: MEMORY, frozenLevel: FROZEN_LEVEL, stillTurn: PHASE_STILL };
})();
