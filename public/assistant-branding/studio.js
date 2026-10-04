import { orbitSeconds, orbitShape } from "./orbit.js";

const states = [
  { id: "idle", name: "Ready", detail: "Breathe, glance, blink", seconds: 8.4, description: "A slow inhale lifts the open layers. A passing glance and a soft blink interrupt the stillness, then everything rests.", status: "Ready when you are", reply: "Ask me to find, compare or organise research." },
  { id: "listening", name: "Listening", detail: "Turn, attend, acknowledge", seconds: 6.4, description: "Orbit leans towards you, opens its eyes and holds its attention. Two quiet responses travel through the ribbons before a small nod.", status: "Listening to your question", reply: "Go ahead. I'm listening." },
  { id: "thinking", name: "Thinking", detail: "Unfold, consider, gather", seconds: 7.2, description: "The ribbons open in counterpoint while the eyes look up. Each layer takes its turn, hangs for a moment, then gathers back into place.", status: "Connecting the evidence", reply: "I'm comparing the findings across studies." },
  { id: "searching", name: "Searching", detail: "Look, sweep, look again", seconds: 6.6, description: "The gaze leads a sweep from left to right. The ribbons follow at different speeds, with a brief double take before returning to centre.", status: "Looking through the literature", reply: "I'm finding studies on class size and learning." },
  { id: "writing", name: "Writing", detail: "Phrase, pause, continue", seconds: 5.8, description: "Three phrases pass through the layers. The eyes follow each line, the lower ribbon answers a beat later, and each phrase has room to breathe.", status: "Putting the findings together", reply: "The strongest results depend on age, setting and how much class sizes change." },
  { id: "complete", name: "Complete", detail: "Anticipate, flourish, settle", seconds: 5.2, description: "A small intake, a lift and a ribbon flourish. The eyes smile as the layers settle, followed by a long, satisfied pause.", status: "Your answer is ready", reply: "The comparison is ready, with sources for each finding." },
];

// The product and this preview use the same SVG paths and keyframes.
const motionCSS = Array.from(document.getElementById("assistant-motion").sheet.cssRules, (rule) => rule.cssText).join("\n");
function mark(motion = "idle", label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" class="assistant-mark" data-motion="${motion}" style="--cycle:${orbitSeconds[motion]}s" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>${orbitShape}</svg>`;
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
