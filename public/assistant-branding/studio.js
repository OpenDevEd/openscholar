const directions = [
  { id: "orbit", name: "Orbit", short: "A companion in open layers", description: "Three open ribbons around an attentive face. The closest connection to the website mark, with a little character of its own." },
  { id: "lens", name: "Lens", short: "A focused, abstract intelligence", description: "Open layers gather around a clear centre. An abstract assistant that focuses, searches and brings evidence together." },
  { id: "ribbon", name: "Ribbon", short: "An idea taking shape", description: "Three curved folds meet in a four-way opening. A sharper AI signal, drawn in the brand's soft, layered geometry." },
];
const states = [
  { id: "idle", name: "Ready", detail: "A slow breath", status: "Ready when you are", reply: "Ask me to find, compare or organise research." },
  { id: "listening", name: "Listening", detail: "Lean in & respond", status: "Listening to your question", reply: "Go ahead. I'm listening." },
  { id: "thinking", name: "Thinking", detail: "Layers in sequence", status: "Connecting the evidence", reply: "I'm comparing the findings across studies." },
  { id: "searching", name: "Searching", detail: "An outward sweep", status: "Looking through the literature", reply: "I'm finding studies on class size and learning." },
  { id: "writing", name: "Writing", detail: "A measured rhythm", status: "Putting the findings together", reply: "The strongest results depend on age, setting and how much class sizes change." },
  { id: "complete", name: "Complete", detail: "Gather & settle", status: "Your answer is ready", reply: "The comparison is ready, with sources for each finding." },
];

// All three concepts share the same motion vocabulary and export path.
const motionCSS = `
.assistant-mark .a { fill: var(--mark-a, #60a5fa); }
.assistant-mark .b { fill: var(--mark-b, #2563eb); }
.assistant-mark .c { fill: var(--mark-c, #bfdbfe); }
.assistant-mark .eye { fill: var(--eye, #172554); }
.assistant-mark .piece, .assistant-mark .body, .assistant-mark .face, .assistant-mark .signal { transform-box: view-box; transform-origin: 64px 64px; }
.assistant-mark .lid { transform-box: fill-box; transform-origin: center; }
.assistant-mark .signal { opacity: 0; fill: none; stroke: var(--mark-a, #60a5fa); stroke-width: 2; }
.assistant-mark .tick { opacity: 0; fill: none; stroke: var(--eye, #172554); stroke-width: 5; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 32; stroke-dashoffset: 32; }
.assistant-mark[data-motion="idle"] .body { animation: breathe calc(4.6s * var(--rate, 1)) ease-in-out infinite; }
.assistant-mark[data-motion="idle"] .lid { animation: blink calc(6.4s * var(--rate, 1)) ease-in-out infinite; }
.assistant-mark[data-motion="listening"] .body { animation: attentive calc(2.8s * var(--rate, 1)) ease-in-out infinite; }
.assistant-mark[data-motion="listening"] .p1 { animation: listen-top calc(1.4s * var(--rate, 1)) ease-in-out infinite; }
.assistant-mark[data-motion="listening"] .p3 { animation: listen-bottom calc(1.4s * var(--rate, 1)) ease-in-out infinite; }
.assistant-mark[data-motion="listening"] .face { animation: glance calc(2.8s * var(--rate, 1)) ease-in-out infinite; }
.assistant-mark[data-motion="thinking"] .piece { animation: consider calc(2.4s * var(--rate, 1)) ease-in-out infinite; }
.assistant-mark[data-motion="thinking"] .p2 { animation-delay: calc(-1.6s * var(--rate, 1)); }
.assistant-mark[data-motion="thinking"] .p3 { animation-delay: calc(-.8s * var(--rate, 1)); }
.assistant-mark[data-motion="thinking"] .face { animation: ponder calc(4.8s * var(--rate, 1)) ease-in-out infinite; }
.assistant-mark[data-motion="searching"] .layers { transform-origin: 64px 64px; animation: sweep calc(4.8s * var(--rate, 1)) cubic-bezier(.45,0,.25,1) infinite; }
.assistant-mark[data-motion="searching"] .signal { animation: signal calc(2.4s * var(--rate, 1)) ease-out infinite; }
.assistant-mark[data-motion="writing"] .piece { animation: write-wave calc(1.5s * var(--rate, 1)) ease-in-out infinite; }
.assistant-mark[data-motion="writing"] .p2 { animation-delay: calc(-1s * var(--rate, 1)); }
.assistant-mark[data-motion="writing"] .p3 { animation-delay: calc(-.5s * var(--rate, 1)); }
.assistant-mark[data-motion="complete"] .body { animation: settle calc(3.8s * var(--rate, 1)) cubic-bezier(.22,.8,.3,1) infinite; }
.assistant-mark[data-motion="complete"] .face { animation: face-out calc(3.8s * var(--rate, 1)) ease infinite; }
.assistant-mark[data-motion="complete"] .tick { animation: resolve calc(3.8s * var(--rate, 1)) ease infinite; }
@keyframes breathe { 0%,100% { transform: scale(.97); } 50% { transform: scale(1.025); } }
@keyframes blink { 0%,42%,47%,100% { transform: scaleY(1); } 44%,45% { transform: scaleY(.12); } }
@keyframes attentive { 0%,100% { transform: translateY(1px); } 50% { transform: translateY(-3px); } }
@keyframes listen-top { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
@keyframes listen-bottom { 0%,100% { transform: translateY(0); } 50% { transform: translateY(3px); } }
@keyframes glance { 0%,100% { transform: translateX(0); } 35%,65% { transform: translateX(3px); } }
@keyframes consider { 0%,100% { opacity: 1; transform: translateY(0); } 50% { opacity: .4; transform: translateY(-3px); } }
@keyframes ponder { 0%,100% { transform: translate(0,0); } 30%,70% { transform: translate(2px,-2px); } }
@keyframes sweep { 0%,12% { transform: rotate(0); } 88%,100% { transform: rotate(360deg); } }
@keyframes signal { 0% { opacity: 0; transform: scale(.82); } 20% { opacity: .38; } 90%,100% { opacity: 0; transform: scale(1.2); } }
@keyframes write-wave { 0%,100% { transform: translateY(0); } 45% { transform: translateY(-4px); } 75% { transform: translateY(1px); } }
@keyframes settle { 0%,100% { transform: scale(1); } 12% { transform: scale(.92); } 26% { transform: scale(1.045); } 42%,90% { transform: scale(1); } }
@keyframes face-out { 0%,12%,92%,100% { opacity: 1; } 24%,82% { opacity: 0; } }
@keyframes resolve { 0%,15% { opacity: 0; stroke-dashoffset: 32; } 30%,76% { opacity: 1; stroke-dashoffset: 0; } 88%,100% { opacity: 0; stroke-dashoffset: 0; } }
html[data-paused="true"] .assistant-mark * { animation-play-state: paused !important; }
@media (prefers-reduced-motion: reduce) { .assistant-mark * { animation: none !important; } }
`;
const style = document.createElement("style");
style.id = "assistant-motion";
style.textContent = motionCSS;
document.head.append(style);

const shapes = {
  orbit: `<g class="layers">
    <path class="piece p1 a" d="M103 41C89 22 52 16 31 29C17 38 16 53 25 65C14 56 11 40 23 28C42 9 86 11 104 32C108 37 108 42 103 41Z"/>
    <path class="piece p2 c" d="M21 57C26 77 52 87 78 85C92 84 105 79 112 71C109 84 91 94 73 96C48 99 20 85 17 67C16 61 17 56 21 57Z"/>
    <path class="piece p3 b" d="M27 84C46 101 79 106 106 91C97 108 64 116 42 105C33 101 27 94 25 88C24 85 25 83 27 84Z"/>
  </g><g class="face"><rect class="eye lid" x="49" y="45" width="8" height="18" rx="4"/><rect class="eye lid" x="72" y="45" width="8" height="18" rx="4"/></g>`,
  lens: `<g class="layers">
    <path class="piece p1 a" d="M105 41C95 24 78 17 61 19C38 21 22 38 22 60C22 70 25 77 31 84C17 75 12 61 17 45C24 22 47 11 69 14C88 16 101 26 107 37C109 41 108 44 105 41Z"/>
    <path class="piece p2 c" d="M35 42C53 28 80 32 92 50C100 63 95 80 81 89C74 93 67 95 59 94C75 101 96 91 101 75C109 52 91 29 69 27C54 26 41 31 34 39C31 42 32 45 35 42Z"/>
    <path class="piece p3 b" d="M29 72C39 96 71 106 96 92C105 87 111 79 113 70C114 91 96 110 72 113C47 116 23 98 23 77C23 72 26 68 29 72Z"/>
  </g><g class="face"><path class="eye" d="M64 46C66 56 70 60 81 64C70 67 67 71 64 82C61 71 57 67 47 64C57 61 61 57 64 46Z"/></g>`,
  ribbon: `<g class="layers">
    <path class="piece p1 a" d="M61 14C63 14 64 16 64 20C64 42 76 51 103 59C107 60 107 64 103 65C91 68 79 64 69 58C53 48 48 33 57 17C58 15 59 14 61 14Z"/>
    <path class="piece p2 c" d="M114 66C114 68 112 69 108 69C86 69 77 80 69 106C68 111 64 111 63 106C60 94 64 82 70 72C80 56 95 52 111 62C113 63 114 64 114 66Z"/>
    <path class="piece p3 b" d="M62 113C59 113 58 110 58 107C59 82 46 73 18 67C13 66 13 62 18 61C31 58 42 59 51 64C42 52 29 51 17 54C30 41 48 45 57 58C65 70 69 82 69 94C69 104 65 113 62 113Z"/>
  </g><g class="face"><path class="eye" d="M57 58Q60 55 62 59L65 65Q66 68 63 69Q61 70 60 67Z"/></g>`,
};

function mark(kind, motion = "idle", label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" class="assistant-mark" data-motion="${motion}" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}><g class="body">${shapes[kind]}<path class="tick" d="m52 64 8 8 17-19"/></g><path class="signal" d="M64 10a54 54 0 1 1-.01 0"/></svg>`;
}

let selected = "orbit";
let motion = "thinking";
let paused = false;
const byId = (id) => document.getElementById(id);
byId("brand-mark").innerHTML = '<img src="../icon.svg" width="33" height="33" alt="">';

byId("direction-options").innerHTML = directions.map((direction, index) => `<button class="direction-option" data-direction="${direction.id}" aria-pressed="${selected === direction.id}"><span class="option-mark">${mark(direction.id, "idle")}</span><span><span class="option-number">0${index + 1}</span><span class="option-name">${direction.name}</span><span class="option-detail">${direction.short}</span></span><span class="selection-check" aria-hidden="true">✓</span></button>`).join("");
byId("motion-options").innerHTML = states.map((state) => `<button class="motion-option" data-state="${state.id}" aria-pressed="${motion === state.id}"><span class="motion-mark">${mark(selected, state.id)}</span><span class="motion-name">${state.name}</span><span class="motion-detail">${state.detail}</span></button>`).join("");

function updateHero() {
  const direction = directions.find((item) => item.id === selected);
  const state = states.find((item) => item.id === motion);
  byId("hero-index").textContent = `0${directions.indexOf(direction) + 1} / ${direction.name}`;
  byId("direction-name").textContent = direction.name;
  byId("direction-description").textContent = direction.description;
  byId("hero-state").textContent = state.name;
  byId("chat-status").textContent = state.status;
  byId("reply-text").textContent = state.reply;
  byId("hero-mark").innerHTML = mark(selected, motion, `${direction.name} assistant, ${state.name.toLowerCase()}`);
  byId("chat-mark").innerHTML = mark(selected, "idle");
  byId("reply-mark").innerHTML = mark(selected, motion);
}

function updateDirection() {
  document.querySelectorAll("[data-direction]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.direction === selected)));
  document.querySelectorAll("[data-state]").forEach((button) => { button.querySelector(".motion-mark").innerHTML = mark(selected, button.dataset.state); });
  byId("size-samples").innerHTML = [16, 24, 32, 48].map((size) => `<div class="size-sample"><span style="width:${size}px;height:${size}px">${mark(selected, "still")}</span><span>${size}px</span></div>`).join("");
  for (const id of ["launcher-mark", "wordmark-icon"]) byId(id).innerHTML = mark(selected, "idle");
  updateHero();
}

byId("direction-options").addEventListener("click", (event) => {
  const button = event.target.closest("[data-direction]");
  if (!button) return;
  selected = button.dataset.direction;
  updateDirection();
});
byId("motion-options").addEventListener("click", (event) => {
  const button = event.target.closest("[data-state]");
  if (!button) return;
  motion = button.dataset.state;
  document.querySelectorAll("[data-state]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
  updateHero();
});
byId("themes").addEventListener("click", (event) => {
  const button = event.target.closest("[data-theme-choice]");
  if (!button) return;
  document.documentElement.dataset.theme = button.dataset.themeChoice;
  document.querySelectorAll("[data-theme-choice]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
});
byId("speed").addEventListener("change", (event) => document.documentElement.style.setProperty("--rate", event.target.value));
byId("pause").addEventListener("click", () => {
  paused = !paused;
  document.documentElement.dataset.paused = String(paused);
  byId("pause").setAttribute("aria-pressed", String(paused));
  byId("pause").textContent = paused ? "Play motion" : "Pause motion";
});

function exportSVG(animated) {
  const computed = getComputedStyle(document.documentElement);
  const variables = ["mark-a", "mark-b", "mark-c", "eye", "rate"].map((name) => `--${name}:${computed.getPropertyValue(`--${name}`).trim()}`).join(";");
  const svg = new DOMParser().parseFromString(mark(selected, animated ? motion : "still", `OpenScholar ${selected} assistant`), "image/svg+xml").documentElement;
  svg.setAttribute("width", "128");
  svg.setAttribute("height", "128");
  svg.setAttribute("style", variables);
  const css = document.createElementNS("http://www.w3.org/2000/svg", "style");
  css.textContent = motionCSS;
  svg.prepend(css);
  return new XMLSerializer().serializeToString(svg);
}

function download(animated) {
  const url = URL.createObjectURL(new Blob([exportSVG(animated)], { type: "image/svg+xml" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `openscholar-assistant-${selected}-${animated ? motion : "still"}-${document.documentElement.dataset.theme}.svg`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  byId("download-status").textContent = `Downloaded ${link.download}`;
}
byId("download-animated").addEventListener("click", () => download(true));
byId("download-static").addEventListener("click", () => download(false));

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
function updateMotionPreference() {
  const reduced = reducedMotion.matches;
  byId("pause").disabled = reduced;
  byId("speed").disabled = reduced;
  byId("motion-note").textContent = reduced ? "Motion is off to respect your reduced-motion preference. SVG downloads keep that preference too." : "Completion repeats here for comparison. In the product, it would play once.";
}
reducedMotion.addEventListener("change", updateMotionPreference);
updateMotionPreference();
updateDirection();
