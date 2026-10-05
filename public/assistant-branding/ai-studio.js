const variants = [
  { id: "gather", name: "Gather", load: "The layers sweep round into place, then the star springs in.", hover: "The star springs a quarter turn and the layers recoil.", loop: "That beat, repeated: a turn of the star, a recoil of the layers." },
  { id: "draw", name: "Draw", load: "Each ribbon is drawn along its circle, then the star springs in.", hover: "A soft light runs once round the ribbons.", loop: "The light keeps circling the ribbons, the star pulses each lap." },
  { id: "focus", name: "Focus", load: "The layers close in like an iris as the star turns into focus.", hover: "The iris opens as the star tightens.", loop: "The iris breathes round a star that turns a quarter each beat." },
  { id: "orbit", name: "Orbit", load: "The layers spiral out into place.", hover: "The layers go round once against the star.", loop: "The outer layers circle, the inner one turns the other way." },
];
const byId = (id) => document.getElementById(id);
let selected = "gather";
let tone = "brand";
let looping = true;

byId("variants").innerHTML = variants.map((variant, index) => `
  <button class="variant" data-variant-choice="${variant.id}" aria-pressed="${variant.id === selected}">
    <span class="variant-top"><span class="variant-number">0${index + 1}</span><span class="variant-check" aria-hidden="true">✓</span></span>
    <span class="variant-art">${aiMark.html(168, { variant: variant.id, label: `${variant.name} AI mark` })}</span>
    <span class="variant-small"><span>${aiMark.html(48, { variant: variant.id })}</span><span>${aiMark.html(24, { variant: variant.id })}</span><span>${aiMark.html(16, { variant: variant.id })}</span></span>
    <span class="variant-name">${variant.name}</span>
    <span class="variant-line"><b>Load</b>${variant.load}</span>
    <span class="variant-line"><b>Hover</b>${variant.hover}</span>
    <span class="variant-phase" aria-hidden="true"><i data-phase="load">Load</i><i data-phase="hover">Hover</i></span>
  </button>`).join("");

const loops = byId("loops");
loops.innerHTML = variants.map((variant) => `<div class="loop"><span class="loop-art">${aiMark.html(120, { variant: variant.id, label: `${variant.name} AI mark, working` })}</span><span class="loop-small">${aiMark.html(24, { variant: variant.id })}${aiMark.html(16, { variant: variant.id })}</span><span class="loop-name">${variant.name}</span><span class="loop-detail">${variant.loop}</span></div>`).join("");
loops.querySelectorAll(".ai-mark").forEach((svg) => aiMark.play(svg, "loop"));

function renderProduct() {
  for (const trigger of document.querySelectorAll(".ai-trigger")) {
    trigger.querySelector(".slot").innerHTML = aiMark.html(Number(trigger.dataset.icon), { variant: selected, tone });
  }
  byId("size-samples").innerHTML = [14, 16, 20, 24, 32, 48, 64].map((size) => `<div class="size-sample"><span>${aiMark.html(size, { variant: selected, tone })}</span><span>${size}px</span></div>`).join("");
  document.querySelectorAll("#product .ai-mark, #size-samples .ai-mark").forEach((svg) => aiMark.play(svg, "load"));
  if (byId("generate").getAttribute("aria-pressed") === "true") aiMark.play(byId("generate").querySelector(".ai-mark"), "loop");
}

// The cards replay load, then hover, so every gesture can be watched without interacting.
function playCard(card, gesture) {
  card.querySelectorAll(".ai-mark").forEach((svg) => aiMark.play(svg, gesture));
  card.dataset.phase = gesture;
}
let step = 0;
function loop() {
  if (!looping) return;
  const gesture = step % 2 === 0 ? "load" : "hover";
  document.querySelectorAll(".variant").forEach((card) => playCard(card, gesture));
  step++;
}
loop();
setInterval(loop, 1900);

byId("variants").addEventListener("pointerover", (event) => {
  const svg = event.target.closest(".variant-art .ai-mark, .variant-small .ai-mark");
  if (svg) aiMark.play(svg, "hover");
});
byId("variants").addEventListener("click", (event) => {
  const card = event.target.closest("[data-variant-choice]");
  if (!card) return;
  selected = card.dataset.variantChoice;
  document.querySelectorAll("[data-variant-choice]").forEach((item) => item.setAttribute("aria-pressed", String(item === card)));
  renderProduct();
});
byId("product").addEventListener("pointerover", (event) => {
  const trigger = event.target.closest(".ai-trigger");
  if (trigger && !trigger.contains(event.relatedTarget)) aiMark.play(trigger.querySelector(".ai-mark"), "hover");
});
byId("tones").addEventListener("click", (event) => {
  const button = event.target.closest("[data-tone-choice]");
  if (!button) return;
  tone = button.dataset.toneChoice;
  document.querySelectorAll("[data-tone-choice]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
  renderProduct();
});
byId("replay-load").addEventListener("click", renderProduct);
byId("autoplay").addEventListener("click", () => {
  looping = !looping;
  byId("autoplay").setAttribute("aria-pressed", String(looping));
  byId("autoplay").textContent = looping ? "Pause the loop" : "Play the loop";
  if (looping) loop();
  else document.querySelectorAll(".variant").forEach((card) => card.removeAttribute("data-phase"));
});
byId("themes").addEventListener("click", (event) => {
  const button = event.target.closest("[data-theme-choice]");
  if (!button) return;
  document.documentElement.dataset.theme = button.dataset.themeChoice;
  document.querySelectorAll("[data-theme-choice]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
});
renderProduct();
byId("loop-toggle").addEventListener("click", () => {
  const working = byId("loop-toggle").getAttribute("aria-pressed") !== "true";
  byId("loop-toggle").setAttribute("aria-pressed", String(working));
  byId("loop-toggle").textContent = working ? "Stop working" : "Start working";
  loops.querySelectorAll(".ai-mark").forEach((svg) => working ? aiMark.play(svg, "loop") : aiMark.stop(svg));
});
byId("generate").addEventListener("click", () => {
  const button = byId("generate");
  const generating = button.getAttribute("aria-pressed") !== "true";
  button.setAttribute("aria-pressed", String(generating));
  const svg = button.querySelector(".ai-mark");
  if (generating) aiMark.play(svg, "loop");
  else aiMark.stop(svg);
});
