// Brings generated art to life: the sheets drift, and light splits into its colours around the pointer. The <img> underneath stays the real, instant picture.
const VS = "attribute vec2 p;varying vec2 v;void main(){v=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}";
const FS = `precision mediump float;uniform sampler2D t;uniform float s,e;uniform vec2 m,a,cs,co;varying vec2 v;
void main(){vec2 d=vec2(sin(v.y*7.+s*.32)+.5*sin(v.y*19.-s*.46),cos(v.x*6.+s*.27)+.4*sin(v.x*17.+s*.38))*.0034;
vec2 q=(v-m)*a;float r=exp(-dot(q,q)*14.)*e;vec2 c=(v+d-q*r*.14)*cs+co;float g=r*.012;
gl_FragColor=vec4(texture2D(t,c+vec2(g,0.)).r,texture2D(t,c).g,texture2D(t,c-vec2(g,0.)).b,1.);}`;
const still = matchMedia("(prefers-reduced-motion: reduce)");
for (const box of document.querySelectorAll("[data-live]")) {
  const img = box.querySelector("img"), c = document.createElement("canvas"), gl = c.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" });
  if (!gl) continue;
  const pr = gl.createProgram();
  for (const [k, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]]) { const o = gl.createShader(k); gl.shaderSource(o, src); gl.compileShader(o); gl.attachShader(pr, o); }
  gl.linkProgram(pr); gl.useProgram(pr);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const at = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
  const u = (n) => gl.getUniformLocation(pr, n), uS = u("s"), uM = u("m"), uA = u("a"), uE = u("e");
  // Match the image's object-fit: cover, so the canvas lands exactly on the picture.
  const [px, py] = (box.dataset.live || "50% 50%").split(" ").map((x) => (x === "right" || x === "bottom" ? 1 : x === "left" || x === "top" ? 0 : parseFloat(x) / 100));
  let seen = false, raf = 0, mx = .5, my = .5, tx = .5, ty = .5, e = 0, te = 0;
  const size = () => { const r = box.getBoundingClientRect(), k = Math.min(devicePixelRatio, 1.5); c.width = r.width * k; c.height = r.height * k; gl.viewport(0, 0, c.width, c.height); gl.uniform2f(uA, r.width / r.height, 1); const f = Math.max(r.width / img.naturalWidth, r.height / img.naturalHeight), sx = r.width / (img.naturalWidth * f), sy = r.height / (img.naturalHeight * f); gl.uniform2f(u("cs"), sx, sy); gl.uniform2f(u("co"), (1 - sx) * px, (1 - sy) * py); };
  const draw = (ms) => { raf = seen && !still.matches ? requestAnimationFrame(draw) : 0; mx += (tx - mx) * .08; my += (ty - my) * .08; e += (te - e) * .06; gl.uniform1f(uS, ms / 1000); gl.uniform2f(uM, mx, my); gl.uniform1f(uE, e); gl.drawArrays(gl.TRIANGLES, 0, 3); };
  const start = () => {
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture()); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE);
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR);
    size(); new ResizeObserver(size).observe(box); box.append(c);
    const wake = () => { if (still.matches) c.style.opacity = 0; else if (seen) { if (!raf) raf = requestAnimationFrame(draw); requestAnimationFrame(() => { if (!still.matches) c.style.opacity = 1; }); } };
    new IntersectionObserver(([en]) => { seen = en.isIntersecting; wake(); }).observe(box); still.addEventListener("change", wake);
    addEventListener("pointermove", (ev) => { const r = box.getBoundingClientRect(); tx = (ev.clientX - r.left) / r.width; ty = (ev.clientY - r.top) / r.height; te = tx > -.1 && tx < 1.1 && ty > -.1 && ty < 1.1 ? 1 : 0; }, { passive: true });
  };
  // Lazy art may not have loaded yet, and the texture needs the bytes.
  img.complete && img.naturalWidth ? img.decode().then(start, start) : img.addEventListener("load", start, { once: true });
}
