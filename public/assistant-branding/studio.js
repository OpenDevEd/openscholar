const states = [
  { id: "idle", name: "Ready", detail: "Breathe, glance, blink", seconds: 8.4, description: "A slow inhale lifts the open layers. A passing glance and a soft blink interrupt the stillness, then everything rests.", status: "Ready when you are", reply: "Ask me to find, compare or organise research." },
  { id: "listening", name: "Listening", detail: "Turn, attend, acknowledge", seconds: 6.4, description: "Orbit leans towards you, opens its eyes and holds its attention. Two quiet responses travel through the ribbons before a small nod.", status: "Listening to your question", reply: "Go ahead. I'm listening." },
  { id: "thinking", name: "Thinking", detail: "Unfold, consider, gather", seconds: 7.2, description: "The ribbons open in counterpoint while the eyes look up. Each layer takes its turn, hangs for a moment, then gathers back into place.", status: "Connecting the evidence", reply: "I'm comparing the findings across studies." },
  { id: "searching", name: "Searching", detail: "Look, sweep, look again", seconds: 6.6, description: "The gaze leads a sweep from left to right. The ribbons follow at different speeds, with a brief double take before returning to centre.", status: "Looking through the literature", reply: "I'm finding studies on class size and learning." },
  { id: "writing", name: "Writing", detail: "Phrase, pause, continue", seconds: 5.8, description: "Three phrases pass through the layers. The eyes follow each line, the lower ribbon answers a beat later, and each phrase has room to breathe.", status: "Putting the findings together", reply: "The strongest results depend on age, setting and how much class sizes change." },
  { id: "complete", name: "Complete", detail: "Anticipate, flourish, settle", seconds: 5.2, description: "A small intake, a lift and a ribbon flourish. The eyes smile as the layers settle, followed by a long, satisfied pause.", status: "Your answer is ready", reply: "The comparison is ready, with sources for each finding." },
];

// Each gesture shares one clock. Every loop starts and ends at the resting mark.
const motionCSS = `
.assistant-mark { --cycle: 8.4s; }
.assistant-mark .a { fill: var(--mark-a, #60a5fa); }
.assistant-mark .b { fill: var(--mark-b, #2563eb); }
.assistant-mark .c { fill: var(--mark-c, #bfdbfe); }
.assistant-mark .eye { fill: var(--eye, #172554); }
.assistant-mark .motion-part {
  transform-box: view-box; transform-origin: 64px 64px;
  animation-duration: calc(var(--cycle) * var(--rate, 1));
  animation-timing-function: cubic-bezier(.4, 0, .2, 1);
  animation-iteration-count: infinite;
}
.assistant-mark .eye { transform-box: fill-box; transform-origin: center; }
.assistant-mark .smile, .assistant-mark .accent-line { opacity: 0; fill: none; stroke-linecap: round; stroke-linejoin: round; }
.assistant-mark .smile { stroke: var(--eye, #172554); stroke-width: 3.8; }
.assistant-mark .accent-line { stroke: var(--mark-a, #60a5fa); stroke-width: 1.7; stroke-dasharray: 1; stroke-dashoffset: 1; }
.assistant-mark .ink-line { stroke: var(--mark-b, #2563eb); stroke-width: 2; }
.assistant-mark[data-motion="idle"] .body { animation-name: o-idle-body; }
.assistant-mark[data-motion="idle"] .p1 { animation-name: o-idle-crown; }
.assistant-mark[data-motion="idle"] .p2 { animation-name: o-idle-middle; }
.assistant-mark[data-motion="idle"] .p3 { animation-name: o-idle-base; }
.assistant-mark[data-motion="idle"] .face { animation-name: o-idle-gaze; }
.assistant-mark[data-motion="idle"] .eye { animation-name: o-idle-blink; }
.assistant-mark[data-motion="listening"] .body { animation-name: o-listening-body; }
.assistant-mark[data-motion="listening"] .p1 { animation-name: o-listening-crown; }
.assistant-mark[data-motion="listening"] .p2 { animation-name: o-listening-middle; }
.assistant-mark[data-motion="listening"] .p3 { animation-name: o-listening-base; }
.assistant-mark[data-motion="listening"] .face { animation-name: o-listening-gaze; }
.assistant-mark[data-motion="listening"] .eye { animation-name: o-listening-eyes; }
.assistant-mark[data-motion="listening"] .listen-near { animation-name: o-listening-near; }
.assistant-mark[data-motion="listening"] .listen-far { animation-name: o-listening-far; }
.assistant-mark[data-motion="thinking"] .body { animation-name: o-thinking-body; }
.assistant-mark[data-motion="thinking"] .p1 { animation-name: o-thinking-crown; }
.assistant-mark[data-motion="thinking"] .p2 { animation-name: o-thinking-middle; }
.assistant-mark[data-motion="thinking"] .p3 { animation-name: o-thinking-base; }
.assistant-mark[data-motion="thinking"] .face { animation-name: o-thinking-gaze; }
.assistant-mark[data-motion="thinking"] .eye-left { animation-name: o-thinking-left; }
.assistant-mark[data-motion="thinking"] .eye-right { animation-name: o-thinking-right; }
.assistant-mark[data-motion="searching"] .body { animation-name: o-searching-body; }
.assistant-mark[data-motion="searching"] .p1 { animation-name: o-searching-crown; }
.assistant-mark[data-motion="searching"] .p2 { animation-name: o-searching-middle; }
.assistant-mark[data-motion="searching"] .p3 { animation-name: o-searching-base; }
.assistant-mark[data-motion="searching"] .face { animation-name: o-searching-gaze; }
.assistant-mark[data-motion="searching"] .eye { animation-name: o-searching-eyes; }
.assistant-mark[data-motion="searching"] .scan-line { animation-name: o-searching-trace; }
.assistant-mark[data-motion="writing"] .body { animation-name: o-writing-body; }
.assistant-mark[data-motion="writing"] .p1 { animation-name: o-writing-crown; }
.assistant-mark[data-motion="writing"] .p2 { animation-name: o-writing-middle; }
.assistant-mark[data-motion="writing"] .p3 { animation-name: o-writing-base; }
.assistant-mark[data-motion="writing"] .face { animation-name: o-writing-gaze; }
.assistant-mark[data-motion="writing"] .eye { animation-name: o-writing-eyes; }
.assistant-mark[data-motion="writing"] .ink-line { animation-name: o-writing-ink; }
.assistant-mark[data-motion="complete"] .body { animation-name: o-complete-body; }
.assistant-mark[data-motion="complete"] .p1 { animation-name: o-complete-crown; }
.assistant-mark[data-motion="complete"] .p2 { animation-name: o-complete-middle; }
.assistant-mark[data-motion="complete"] .p3 { animation-name: o-complete-base; }
.assistant-mark[data-motion="complete"] .face { animation-name: o-complete-gaze; }
.assistant-mark[data-motion="complete"] .normal-eyes { animation-name: o-complete-eyes; }
.assistant-mark[data-motion="complete"] .smile { animation-name: o-complete-smile; }

@keyframes o-idle-body {
  0%,12%,84%,100% { transform: translateY(0) scale(1); }
  38%,46% { transform: translateY(-1.8px) scale(1.006,1.012); }
}
@keyframes o-idle-crown {
  0%,12%,84%,100% { transform: translateY(0) rotate(0); }
  38%,46% { transform: translateY(-1.2px) rotate(-1.2deg); }
}
@keyframes o-idle-middle { 0%,12%,84%,100% { transform: translateY(0); } 40%,48% { transform: translateY(.8px); } }
@keyframes o-idle-base { 0%,14%,86%,100% { transform: translateY(0); } 42%,50% { transform: translateY(1.5px); } }
@keyframes o-idle-gaze { 0%,57%,78%,100% { transform: translate(0,0); } 63%,69% { transform: translate(1.8px,-.5px); } }
@keyframes o-idle-blink {
  0%,48%,52%,91%,95%,100% { transform: scaleY(1); }
  49.5%,50% { transform: scaleY(.12); }
  92.5%,93% { transform: scaleY(.15); }
}

@keyframes o-listening-body {
  0%,94%,100% { transform: translate(0,0) rotate(0); }
  14%,44% { transform: translate(2px,-2px) rotate(-5deg); }
  51% { transform: translate(2px,.6px) rotate(-2deg); }
  59%,69% { transform: translate(2px,-2px) rotate(-4deg); }
  77% { transform: translate(1px,1px) rotate(-1deg); }
}
@keyframes o-listening-crown {
  0%,94%,100% { transform: translate(0,0) rotate(0); }
  16%,38% { transform: translate(-1px,-3px) rotate(-3deg); }
  48% { transform: translate(0,-1px) rotate(-1deg); }
  59%,68% { transform: translate(-1px,-3.5px) rotate(-3deg); }
}
@keyframes o-listening-middle {
  0%,94%,100% { transform: translate(0,0) rotate(0); }
  20%,40% { transform: translate(2px,1.5px) rotate(2deg); }
  51% { transform: translate(0,0) rotate(0); }
  62%,71% { transform: translate(1px,2px) rotate(2deg); }
}
@keyframes o-listening-base {
  0%,94%,100% { transform: translate(0,0) scaleX(1); }
  23%,42% { transform: translate(1px,2px) scaleX(1.025); }
  53% { transform: translate(0,0) scaleX(1); }
  65%,74% { transform: translate(1px,2px) scaleX(1.02); }
}
@keyframes o-listening-gaze {
  0%,94%,100% { transform: translate(0,0); }
  13%,43% { transform: translate(3px,-.5px); }
  51% { transform: translate(2px,1px); }
  60%,71% { transform: translate(3px,-.5px); }
}
@keyframes o-listening-eyes {
  0%,94%,100% { transform: scale(1); }
  13%,43%,55%,70% { transform: scale(.96,1.13); }
  49%,50% { transform: scale(1,.16); }
  77%,81% { transform: scale(1,.9); }
}
@keyframes o-listening-near {
  0%,18%,46%,52%,82%,100% { opacity: 0; stroke-dashoffset: 1; transform: translateX(-2px); }
  26%,34%,61%,69% { opacity: .65; stroke-dashoffset: 0; transform: translateX(0); }
  43%,78% { opacity: 0; stroke-dashoffset: -.12; transform: translateX(1.5px); }
}
@keyframes o-listening-far {
  0%,22%,50%,57%,86%,100% { opacity: 0; stroke-dashoffset: 1; transform: translateX(-2px); }
  31%,36%,66%,71% { opacity: .3; stroke-dashoffset: 0; transform: translateX(0); }
  46%,82% { opacity: 0; stroke-dashoffset: -.12; transform: translateX(1px); }
}

@keyframes o-thinking-body {
  0%,96%,100% { transform: translateY(0) scale(1); }
  9% { transform: translateY(1.4px) scale(.985); }
  26%,61% { transform: translateY(-2px) scale(1); }
  82% { transform: translateY(.5px) scale(1); }
}
@keyframes o-thinking-crown {
  0%,7%,91%,100% { transform: translate(0,0) rotate(0); }
  26%,47% { transform: translate(-1px,-4px) rotate(-10deg); }
  62% { transform: translate(1px,-2px) rotate(-5deg); }
  79% { transform: translate(.5px,.5px) rotate(1.5deg); }
}
@keyframes o-thinking-middle {
  0%,13%,95%,100% { transform: translate(0,0) rotate(0); }
  34%,52% { transform: translate(2px,2px) rotate(7deg); }
  68% { transform: translate(-1px,1px) rotate(-2deg); }
  85% { transform: translate(0,-.5px) rotate(-1deg); }
}
@keyframes o-thinking-base {
  0%,21%,98%,100% { transform: translate(0,0) rotate(0); }
  43%,59% { transform: translate(-2px,4px) rotate(-5deg); }
  76% { transform: translate(1px,1px) rotate(2deg); }
  89% { transform: translate(0,-.5px) rotate(0); }
}
@keyframes o-thinking-gaze {
  0%,9%,94%,100% { transform: translate(0,0); }
  25%,45% { transform: translate(-2.5px,-3px); }
  55%,64% { transform: translate(2px,-2px); }
  80% { transform: translate(.5px,.5px); }
}
@keyframes o-thinking-left {
  0%,10%,83%,100% { transform: scale(1); }
  25%,46% { transform: scale(.95,.7); }
  53%,54% { transform: scale(1,.12); }
  61%,69% { transform: scale(1,.94); }
}
@keyframes o-thinking-right {
  0%,10%,83%,100% { transform: scale(1); }
  25%,46% { transform: scale(.95,1.07); }
  53%,54% { transform: scale(1,.12); }
  61%,69% { transform: scale(.95,.75); }
}

@keyframes o-searching-body {
  0%,95%,100% { transform: translateX(0) rotate(0); }
  18%,25% { transform: translateX(-2px) rotate(-3deg); }
  49%,56% { transform: translateX(2px) rotate(3deg); }
  64% { transform: translate(2.8px,-1px) rotate(4deg); }
  79% { transform: translateX(-.5px) rotate(-1deg); }
}
@keyframes o-searching-crown {
  0%,95%,100% { transform: translateX(0) rotate(0) scaleX(1); }
  20%,27% { transform: translateX(-2px) rotate(-7deg) scaleX(.97); }
  51%,58% { transform: translateX(2px) rotate(8deg) scaleX(.98); }
  66% { transform: translateX(3px) rotate(10deg) scaleX(.97); }
  82% { transform: translateX(-.5px) rotate(-2deg) scaleX(1); }
}
@keyframes o-searching-middle {
  0%,97%,100% { transform: translateX(0) rotate(0); }
  24%,30% { transform: translateX(2px) rotate(5deg); }
  55%,62% { transform: translateX(-2px) rotate(-6deg); }
  70% { transform: translateX(-2.5px) rotate(-7deg); }
  85% { transform: translateX(.5px) rotate(1.5deg); }
}
@keyframes o-searching-base {
  0%,99%,100% { transform: translateX(0) rotate(0); }
  28%,33% { transform: translateX(-1px) rotate(-3deg); }
  59%,66% { transform: translateX(1px) rotate(4deg); }
  75% { transform: translateX(.5px) rotate(2deg); }
  89% { transform: translateX(-.3px) rotate(-1deg); }
}
@keyframes o-searching-gaze {
  0%,95%,100% { transform: translate(0,0); }
  14%,24% { transform: translate(-5px,.5px); }
  44%,54% { transform: translate(5px,-.5px); }
  59% { transform: translate(2px,0); }
  64%,69% { transform: translate(6px,-1.5px); }
  80% { transform: translate(-1px,0); }
}
@keyframes o-searching-eyes {
  0%,9%,37%,46%,69%,86%,100% { transform: scaleY(1); }
  17%,25%,53%,57% { transform: scaleY(.76); }
  32%,33%,78%,79% { transform: scaleY(.13); }
  63%,65% { transform: scaleY(1.13); }
}
@keyframes o-searching-trace {
  0%,14%,68%,100% { opacity: 0; stroke-dashoffset: 1; }
  23% { opacity: .4; stroke-dashoffset: .85; }
  49% { opacity: .4; stroke-dashoffset: 0; }
  61% { opacity: 0; stroke-dashoffset: -.08; }
}

@keyframes o-writing-body {
  0%,94%,100% { transform: translate(0,0) rotate(0); }
  12%,78% { transform: translate(0,1px) rotate(2deg); }
}
@keyframes o-writing-crown {
  0%,7%,32%,41%,62%,72%,95%,100% { transform: translate(0,0) rotate(0); }
  19% { transform: translate(1px,-2.1px) rotate(-2.5deg); }
  51% { transform: translate(1px,-1.5px) rotate(-2deg); }
  82% { transform: translate(1px,-2.6px) rotate(-3deg); }
}
@keyframes o-writing-middle {
  0%,11%,36%,45%,66%,76%,98%,100% { transform: translate(0,0) rotate(0); }
  23% { transform: translate(1.3px,-1.9px) rotate(1.8deg); }
  55% { transform: translate(1px,-1.4px) rotate(1.4deg); }
  86% { transform: translate(1.5px,-2.2px) rotate(2deg); }
}
@keyframes o-writing-base {
  0%,15%,40%,49%,70%,80%,98%,100% { transform: translate(0,0) rotate(0); }
  27% { transform: translate(1px,-1.8px) rotate(-1.4deg); }
  59% { transform: translate(.8px,-1.2px) rotate(-1deg); }
  90% { transform: translate(1.2px,-2px) rotate(-1.7deg); }
}
@keyframes o-writing-gaze {
  0%,97%,100% { transform: translate(0,0); }
  10% { transform: translate(-3px,1.5px); }
  27%,32% { transform: translate(3px,1.5px); }
  41% { transform: translate(-3px,2px); }
  58%,63% { transform: translate(2px,2px); }
  72% { transform: translate(-2.5px,2px); }
  89% { transform: translate(4px,2px); }
}
@keyframes o-writing-eyes {
  0%,97%,100% { transform: scaleY(1); }
  12%,30%,42%,62%,74%,91% { transform: scaleY(.85); }
  35%,36%,66%,67% { transform: scaleY(.14); }
}
@keyframes o-writing-ink {
  0%,11%,98%,100% { opacity: 0; stroke-dashoffset: 1; }
  18% { opacity: .45; stroke-dashoffset: .88; }
  30%,40% { opacity: .45; stroke-dashoffset: .64; }
  61%,71% { opacity: .45; stroke-dashoffset: .34; }
  89% { opacity: .45; stroke-dashoffset: 0; }
  96% { opacity: 0; stroke-dashoffset: 0; }
}

@keyframes o-complete-body {
  0%,57%,100% { transform: translateY(0) scale(1); }
  10% { transform: translateY(2.5px) scale(1.015,.96); }
  24% { transform: translateY(-3.5px) scale(.98,1.035); }
  37% { transform: translateY(.8px) scale(1.012,.99); }
  46% { transform: translateY(-.4px) scale(1); }
}
@keyframes o-complete-crown {
  0%,8%,56%,100% { transform: translate(0,0) rotate(0); }
  25% { transform: translate(-1px,-3px) rotate(-8deg); }
  40% { transform: translate(.5px,1px) rotate(2deg); }
}
@keyframes o-complete-middle {
  0%,11%,59%,100% { transform: translate(0,0) rotate(0); }
  28% { transform: translate(2px,2px) rotate(6deg); }
  43% { transform: translate(-.5px,-.5px) rotate(-2deg); }
}
@keyframes o-complete-base {
  0%,14%,62%,100% { transform: translate(0,0) rotate(0); }
  31% { transform: translate(-1px,4px) rotate(-4deg); }
  46% { transform: translate(.5px,-1px) rotate(1.5deg); }
}
@keyframes o-complete-gaze {
  0%,8%,70%,100% { transform: translateY(0); }
  17% { transform: translateY(1.5px); }
  29%,55% { transform: translateY(-1px); }
}
@keyframes o-complete-eyes { 0%,12%,76%,100% { opacity: 1; } 20%,65% { opacity: 0; } }
@keyframes o-complete-smile { 0%,14%,78%,100% { opacity: 0; } 23%,63% { opacity: 1; } }
html[data-paused="true"] .assistant-mark * { animation-play-state: paused !important; }
@media (prefers-reduced-motion: reduce) { .assistant-mark * { animation: none !important; } }
`;
const style = document.createElement("style");
style.id = "assistant-motion";
style.textContent = motionCSS;
document.head.append(style);

function mark(motion = "idle", label) {
  const seconds = states.find((state) => state.id === motion)?.seconds ?? 8.4;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" class="assistant-mark" data-motion="${motion}" style="--cycle:${seconds}s" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>
    <g class="body motion-part">
      <g class="layers">
        <path class="piece p1 a motion-part" d="M103 41C89 22 52 16 31 29C17 38 16 53 25 65C14 56 11 40 23 28C42 9 86 11 104 32C108 37 108 42 103 41Z"/>
        <path class="piece p2 c motion-part" d="M21 57C26 77 52 87 78 85C92 84 105 79 112 71C109 84 91 94 73 96C48 99 20 85 17 67C16 61 17 56 21 57Z"/>
        <path class="piece p3 b motion-part" d="M27 84C46 101 79 106 106 91C97 108 64 116 42 105C33 101 27 94 25 88C24 85 25 83 27 84Z"/>
      </g>
      <g class="face motion-part">
        <g class="normal-eyes motion-part"><rect class="eye eye-left motion-part" x="49" y="45" width="8" height="18" rx="4"/><rect class="eye eye-right motion-part" x="72" y="45" width="8" height="18" rx="4"/></g>
        <g class="smile motion-part"><path d="M48.5 54Q53 46.5 57.5 54M71.5 54Q76 46.5 80.5 54"/><path d="M60 68Q65 72 70 67.5" stroke-width="2.7"/></g>
      </g>
      <path class="accent-line ink-line motion-part" pathLength="1" d="M33 82C53 97 81 97 101 86"/>
    </g>
    <path class="accent-line listen-near motion-part" pathLength="1" d="M112 40Q121 49 113 59"/>
    <path class="accent-line listen-far motion-part" pathLength="1" d="M117 33Q130 49 119 65"/>
    <path class="accent-line scan-line motion-part" pathLength="1" d="M15 53C10 22 76 0 112 34"/>
  </svg>`;
}

let motion = "thinking";
let paused = false;
let rate = 1;
let sequencing = false;
let handoffVersion = 0;
let settling = false;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const byId = (id) => document.getElementById(id);
byId("brand-mark").innerHTML = '<img src="../icon.svg" width="33" height="33" alt="">';
byId("hero-mark").innerHTML = mark(motion, "Orbit assistant, thinking");
byId("reply-mark").innerHTML = mark(motion);
for (const id of ["chat-mark", "launcher-mark", "wordmark-icon"]) byId(id).innerHTML = mark("idle");
byId("motion-options").innerHTML = states.map((state, index) => `<button class="motion-option" data-state="${state.id}" aria-pressed="${motion === state.id}"><span class="motion-number">0${index + 1}</span><span class="motion-mark">${mark(state.id)}</span><span class="motion-name">${state.name}</span><span class="motion-detail">${state.detail}</span></button>`).join("");
byId("size-samples").innerHTML = [16, 24, 32, 48].map((size) => `<div class="size-sample"><span style="width:${size}px;height:${size}px">${mark("still")}</span><span>${size}px</span></div>`).join("");

function updateLabels() {
  const state = states.find((item) => item.id === motion);
  byId("hero-state").textContent = state.name;
  byId("direction-name").textContent = state.name;
  byId("direction-description").textContent = state.description;
  byId("chat-status").textContent = state.status;
  byId("reply-text").textContent = state.reply;
  byId("motion-duration").textContent = `${(state.seconds * rate).toFixed(1)} s`;
  byId("hero-mark").firstElementChild.setAttribute("aria-label", `Orbit assistant, ${state.name.toLowerCase()}`);
  document.querySelectorAll("[data-state]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.state === motion)));
  byId("sequence").textContent = sequencing ? "Stop sequence" : "Play a task";
  byId("sequence").setAttribute("aria-pressed", String(sequencing));
}

// Settle from the currently painted pose before starting the next gesture.
// CSS owns the loops; these short handoffs never run alongside them.
async function showMotion(next, smooth = true) {
  const version = ++handoffVersion;
  motion = next;
  settling = true;
  updateLabels();
  const svgs = [byId("hero-mark").firstElementChild, byId("reply-mark").firstElementChild];
  const properties = ["transform", "opacity", "strokeDashoffset"];
  const pose = (node) => Object.fromEntries(properties.map((key) => [key, getComputedStyle(node)[key]]));
  const captured = svgs.flatMap((svg) => Array.from(svg.querySelectorAll(".motion-part"), (node) => ({ node, from: pose(node) })));
  for (const svg of svgs) {
    svg.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
    svg.dataset.motion = "still";
  }
  if (smooth && !paused && !reducedMotion.matches) {
    const bridges = captured.flatMap(({ node, from }) => {
      const to = pose(node);
      if (properties.every((key) => from[key] === to[key])) return [];
      return [node.animate([from, to], { duration: 360 * rate, easing: "cubic-bezier(.22,.7,.25,1)" })];
    });
    await Promise.all(bridges.map((animation) => animation.finished.catch(() => {})));
  }
  if (version !== handoffVersion) return;
  for (const svg of svgs) {
    svg.style.setProperty("--cycle", `${states.find((state) => state.id === next).seconds}s`);
    svg.dataset.motion = next;
  }
  settling = false;
}

byId("motion-options").addEventListener("click", (event) => {
  const button = event.target.closest("[data-state]");
  if (!button) return;
  sequencing = false;
  void showMotion(button.dataset.state);
});
byId("replay").addEventListener("click", () => {
  sequencing = false;
  void showMotion(motion);
});
byId("sequence").addEventListener("click", () => {
  sequencing = !sequencing;
  if (sequencing) void showMotion("idle");
  else updateLabels();
});
byId("hero-mark").addEventListener("animationiteration", (event) => {
  if (!sequencing || settling || !event.target.classList.contains("body")) return;
  const index = states.findIndex((state) => state.id === motion);
  if (index === states.length - 1) sequencing = false;
  void showMotion(states[(index + 1) % states.length].id, false);
});
byId("themes").addEventListener("click", (event) => {
  const button = event.target.closest("[data-theme-choice]");
  if (!button) return;
  document.documentElement.dataset.theme = button.dataset.themeChoice;
  document.querySelectorAll("[data-theme-choice]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
});
byId("speed").addEventListener("change", (event) => {
  const nextRate = Number(event.target.value);
  const clocks = document.getAnimations().filter((animation) => animation instanceof CSSAnimation).map((animation) => ({ animation, time: animation.currentTime }));
  document.documentElement.style.setProperty("--rate", String(nextRate));
  for (const { animation, time } of clocks) animation.currentTime = time * nextRate / rate;
  rate = nextRate;
  updateLabels();
});
byId("pause").addEventListener("click", () => {
  paused = !paused;
  document.documentElement.dataset.paused = String(paused);
  document.getAnimations().forEach((animation) => paused ? animation.pause() : animation.play());
  byId("pause").setAttribute("aria-pressed", String(paused));
  byId("pause").textContent = paused ? "Play motion" : "Pause motion";
});

function exportSVG(animated) {
  const computed = getComputedStyle(document.documentElement);
  const variables = ["mark-a", "mark-b", "mark-c", "eye", "rate"].map((name) => `--${name}:${computed.getPropertyValue(`--${name}`).trim()}`).join(";");
  const svg = new DOMParser().parseFromString(mark(animated ? motion : "still", `OpenScholar Orbit assistant`), "image/svg+xml").documentElement;
  svg.setAttribute("width", "128");
  svg.setAttribute("height", "128");
  svg.setAttribute("style", `${svg.getAttribute("style")};${variables}`);
  const css = document.createElementNS("http://www.w3.org/2000/svg", "style");
  css.textContent = motionCSS;
  svg.prepend(css);
  return new XMLSerializer().serializeToString(svg);
}

function download(animated) {
  const url = URL.createObjectURL(new Blob([exportSVG(animated)], { type: "image/svg+xml" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `openscholar-orbit-${animated ? motion : "still"}-${document.documentElement.dataset.theme}.svg`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  byId("download-status").textContent = `Downloaded ${link.download}`;
}
byId("download-animated").addEventListener("click", () => download(true));
byId("download-static").addEventListener("click", () => download(false));

function updateMotionPreference() {
  const reduced = reducedMotion.matches;
  for (const id of ["pause", "speed", "sequence", "replay"]) byId(id).disabled = reduced;
  byId("motion-note").textContent = reduced ? "Motion is off to respect your reduced-motion preference. SVG downloads keep that preference too." : "Every gesture includes a pause. Completion repeats here for comparison; Play a task runs the six states in order.";
  if (reduced) {
    sequencing = false;
    void showMotion(motion, false);
  }
}
reducedMotion.addEventListener("change", updateMotionPreference);
updateMotionPreference();
updateLabels();
