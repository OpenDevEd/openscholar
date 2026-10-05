const variants = [
  { id: "gather", name: "Gather", load: "The layers swing into place, then the star turns in.", hover: "A quarter turn of the star, the layers lean back." },
  { id: "twinkle", name: "Twinkle", load: "The layers rise in, the star twinkles, a glint flashes.", hover: "The star twinkles again with a fresh glint." },
  { id: "focus", name: "Focus", load: "The layers close in on the star like an aperture.", hover: "The aperture opens, then refocuses on a turning star." },
  { id: "spin", name: "Spin", load: "The layers spin in at different speeds.", hover: "One full turn of the layers against the star." },
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

function renderProduct() {
  for (const trigger of document.querySelectorAll(".ai-trigger")) {
    trigger.querySelector(".slot").innerHTML = aiMark.html(Number(trigger.dataset.icon), { variant: selected, tone });
  }
  byId("size-samples").innerHTML = [14, 16, 20, 24, 32, 48, 64].map((size) => `<div class="size-sample"><span>${aiMark.html(size, { variant: selected, tone })}</span><span>${size}px</span></div>`).join("");
  document.querySelectorAll("#product .ai-mark, #size-samples .ai-mark").forEach((svg) => aiMark.play(svg, "load"));
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
