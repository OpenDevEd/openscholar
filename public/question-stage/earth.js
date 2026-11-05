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
  float wet = textureGrad(water, uv, gx, gy).r; vec3 dc = (textureGrad(day, uv, gx, gy).rgb + wet * vec3(0., .022, .06) + (1. - wet) * vec3(.03, .04, .03)) * vec3(.97, 1., 1.05); vec3 nc = textureGrad(night, uv, gx, gy).rgb; float cl = textureGrad(clouds, uvc, gxc, gyc).r, sh = textureGrad(clouds, uvc + vec2(.0028, -.0018), gxc, gyc).r;
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
  // The hero's sun once it's fully up, and just behind the planet's top edge: there the globe is in shadow with its cities
  // on, under a bright crescent.
  var SUN_UP = [-0.7, 0.62, 0.3];
  var SUN_BEHIND = [0, 0.85, -0.52];
  // Turns a second, in the shader's units. The hero's speed, easing up a little once it has gone.
  var CRUISE = 1.6;
  var PHASE_STILL = 30;
  var smooth = function (t) { return t * t * (3 - 2 * t); };
  var clamp01 = function (v) { return Math.min(1, Math.max(0, v)); };
  var unit = function (v) { var l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };

  var OPTIONS = { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: "low-power" };

  /**
   * Compiles the shader and uploads the four maps. Coming from the hero this runs while the new page is still arriving, so
   * the planet's first frame can be drawn the moment the stage is there. `canvas` is only for a browser without WebGL off
   * screen, which has to draw straight to the canvas on the page.
   */
  var prepared = null;
  function prepare(canvas) {
    if (prepared && (prepared.offscreen || prepared.canvas === canvas)) return prepared;
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
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) console.error("[earth] shader:", gl.getShaderInfoLog(shader));
      return shader;
    };
    var program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var attribute = gl.getAttribLocation(program, "a");
    gl.enableVertexAttribArray(attribute);
    gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
    var uniform = function (name) { return gl.getUniformLocation(program, name); };
    var aniso = gl.getExtension("EXT_texture_filter_anisotropic");
    var self = {
      gl: gl, offscreen: offscreen, canvas: offscreen ? null : canvas, loaded: false,
      U: { c: uniform("c"), r: uniform("r"), t: uniform("t"), sd: uniform("sd"), wv: uniform("wv"), fd: uniform("fd"), L: uniform("L"), rg: uniform("rg") },
    };
    self.textures = Promise.all(IMAGES.map(function (name, i) {
      var image = new Image();
      image.src = DIR + name + ".avif";
      return image.decode().then(function () {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
        gl.uniform1i(uniform(name), i);
      });
    })).then(function () { self.loaded = true; console.info("[earth] maps ready at", Math.round(performance.now()) + "ms"); });
    console.info("[earth] shader ready at", Math.round(performance.now()) + "ms");
    prepared = self;
    return self;
  }

  /**
   * Starts the planet. `turn` is where the hero had got to and when, so that it carries on as if nothing had happened;
   * without one it starts from the still's place, at rest. `ready` runs once its first frame is drawn, or it can't be.
   */
  function start(o) {
    var canvas = o.canvas, layout = o.layout, turn = o.turn;
    var none = { wave: function () {}, sunBehind: function () {}, stop: function () {} };
    var ready = prepare(canvas);
    if (!ready) { o.ready(false); return none; }
    var gl = ready.gl, U = ready.U;
    var buffer = ready.offscreen ? gl.canvas : canvas;
    var shown = ready.offscreen ? canvas.getContext("2d") : null;

    // A little sharper than the hero, as the planet gets zoomed. The width comes from the caller: the stage may be hidden still.
    var d = Math.min(devicePixelRatio || 1, 2);
    canvas.width = buffer.width = Math.round(o.width * d);
    canvas.height = buffer.height = Math.round(o.height * d);
    gl.viewport(0, 0, canvas.width, canvas.height);
    var g = layout.R * 1.55;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(Math.max(0, (layout.cx - g) * d), Math.max(0, canvas.height - (layout.cy + g) * d), g * 2 * d, g * 2 * d);

    var raf = 0, stopped = false, waveAt = -1e9, liveAt = 0, sunAt = 0, sunMs = 1, last = 0;
    var phase = turn ? turn.t : PHASE_STILL;
    var speed = turn ? 1 : 0;

    var draw = function (now) {
      var w = (now - waveAt) / 1800;
      var swing = sunAt ? smooth(clamp01((now - sunAt) / sunMs)) : 0;
      var from = unit(SUN_UP), sun = unit([from[0] + (SUN_BEHIND[0] - from[0]) * swing, from[1] + (SUN_BEHIND[1] - from[1]) * swing, from[2] + (SUN_BEHIND[2] - from[2]) * swing]);
      gl.uniform2f(U.c, layout.cx * d, canvas.height - layout.cy * d);
      gl.uniform1f(U.r, layout.R * d);
      gl.uniform1f(U.t, phase);
      // The still has no ring shadow on the planet, so coming from it, it comes in gently.
      gl.uniform1f(U.sd, turn || !liveAt ? (turn ? 1 : 0) : clamp01((now - liveAt) / 900));
      gl.uniform3f(U.L, sun[0], sun[1], sun[2]);
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

    var dashes = function (svg) { return Array.prototype.slice.call(svg.querySelectorAll("[data-comet]")); };
    var cometsFront = dashes(o.ringFront), cometsBack = dashes(o.ringBack);
    // It swings round the far ends of the ring and hurries across the front, as an orbit does.
    var comet = function (now) {
      var lap = ((now - liveAt) / 4000) % 1;
      var k = (lap + 0.07 * Math.sin(lap * 2 * Math.PI) + 1) % 1;
      var front = k < 0.5;
      var head = (front ? k * 2 : 1 - (k - 0.5) * 2) * 1000;
      (front ? cometsBack : cometsFront).forEach(function (dash) { dash.setAttribute("visibility", "hidden"); });
      (front ? cometsFront : cometsBack).forEach(function (dash) {
        dash.setAttribute("visibility", "visible");
        dash.setAttribute("stroke-dashoffset", (front ? Number(dash.dataset.comet) - head : -head).toFixed(1));
      });
    };

    var loop = function (now) {
      // A stage taken off the page before it finished stops with it.
      if (stopped || (o.stage && !o.stage.isConnected && liveAt && now - liveAt > 2000)) return;
      raf = requestAnimationFrame(loop);
      var dt = Math.min(64, now - last);
      last = now;
      speed += (CRUISE - speed) * (1 - Math.exp(-dt / 2000));
      phase += (speed * dt) / 1000;
      draw(now);
      comet(now);
    };

    var go = function () {
      if (stopped) return;
      // Carries on from where the hero stood still: it stops drawing once this page's response starts arriving, and the
      // screen holds its last frame until this one is ready. Jumping to where it would be now would jolt it forward.
      if (turn) {
        var entry = performance.getEntriesByType("navigation")[0];
        var froze = entry && entry.responseStart ? performance.timeOrigin + entry.responseStart : Date.now();
        phase = turn.t + Math.min(30, Math.max(0, (froze - turn.at) / 1000));
      }
      liveAt = last = performance.now();
      draw(liveAt);
      o.ready(true);
      if (!o.calm) raf = requestAnimationFrame(loop);
    };
    // Ready already, it draws now, before the browser paints the stage for the first time.
    if (ready.loaded) go();
    else ready.textures.then(go, function (error) {
      console.error("[earth] images:", error);
      o.ready(false);
    });

    return {
      /** A wave of light runs down the planet from the question, lighting the cities it passes. */
      wave: function () { waveAt = performance.now(); },
      /** Swings the sun round behind the planet. */
      sunBehind: function (ms) { sunMs = ms; sunAt = performance.now(); },
      stop: function () { stopped = true; cancelAnimationFrame(raf); },
    };
  }

  /**
   * Starts the planet in a stage, reading its settings from the stage's data-earth-config, unless it's already going
   * there. The app calls this too, so a stage React has built itself still gets its planet.
   */
  function boot(stage) {
    var canvas = stage.querySelector("canvas");
    var running = window.questionStageEarthRun;
    if (running && running.canvas === canvas) return running;
    if (running) running.stop();
    var config = JSON.parse(stage.dataset.earthConfig);
    console.info("[earth] stage arrived at", Math.round(performance.now()) + "ms");
    var begun = performance.now();
    console.info("[earth] starting", config.turn ? "from the hero" : "from rest");
    var still = stage.querySelector("[data-still]");
    var run = start({
      stage: stage, canvas: canvas,
      ringBack: stage.querySelector("[data-ring=back]"), ringFront: stage.querySelector("[data-ring=front]"),
      layout: config.layout, width: config.width, height: config.height, turn: config.turn,
      calm: matchMedia("(prefers-reduced-motion: reduce)").matches,
      ready: function (ok) {
        console.info("[earth]", ok ? "drawing" : "can't draw, showing the still", Math.round(performance.now() - begun) + "ms after starting");
        if (ok) { canvas.dataset.live = ""; still.dataset.live = ""; } else still.dataset.failed = "";
        // The browser has been told not to paint until this stylesheet has loaded: removing it lets the page paint now,
        // with the planet in it (lib/search/question-stage-script.ts).
        var hold = document.getElementById("question-stage-hold");
        if (hold) hold.remove();
      },
    });
    run.canvas = canvas;
    window.questionStageEarthRun = run;
    return run;
  }

  // Loaded early by the page's first script (lib/search/question-stage-script.ts), it gets the planet ready while the page is
  // still arriving, and starts it the moment the stage is there, before the app's own scripts.
  console.info("[earth] script ran at", Math.round(performance.now()) + "ms");
  if (location.search.indexOf("hero=") !== -1) prepare(null);
  // The page arrives in pieces, so it waits for the stage's last part, the ring in front, before starting.
  var find = function () {
    var stage = document.querySelector("#question-stage[data-earth-config]");
    if (!stage || !stage.querySelector("[data-ring=front]")) return false;
    try { boot(stage); } catch (error) { console.error("[earth] couldn't start:", error); }
    return true;
  };
  if (!find()) {
    var watching = new MutationObserver(function () { if (find()) watching.disconnect(); });
    watching.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(function () { watching.disconnect(); }, 20000);
  }

  window.questionStageEarth = { boot: boot };
})();
