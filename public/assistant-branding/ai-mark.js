// The AI mark: the Lens star from the first assistant study, for features that use AI.
// Below 28px it switches to a compact drawing so the star still reads at icon sizes.
(() => {
  const star = (x, y, s) => `M${x} ${y - s}C${x + 2.5} ${y - s * 0.3} ${x + s * 0.3} ${y - 2.5} ${x + s} ${y}C${x + s * 0.3} ${y + 2.5} ${x + 2.5} ${y + s * 0.3} ${x} ${y + s}C${x - 2.5} ${y + s * 0.3} ${x - s * 0.3} ${y + 2.5} ${x - s} ${y}C${x - s * 0.3} ${y - 2.5} ${x - 2.5} ${y - s * 0.3} ${x} ${y - s}Z`;
  const full = `<path class="part ring-top" fill="currentColor" d="M105 41C95 24 78 17 61 19C38 21 22 38 22 60C22 70 25 77 31 84C17 75 12 61 17 45C24 22 47 11 69 14C88 16 101 26 107 37C109 41 108 44 105 41Z"/>
    <path class="part ring-mid" fill="currentColor" d="M35 42C53 28 80 32 92 50C100 63 95 80 81 89C74 93 67 95 59 94C75 101 96 91 101 75C109 52 91 29 69 27C54 26 41 31 34 39C31 42 32 45 35 42Z"/>
    <path class="part ring-bottom" fill="currentColor" d="M29 72C39 96 71 106 96 92C105 87 111 79 113 70C114 91 96 110 72 113C47 116 23 98 23 77C23 72 26 68 29 72Z"/>
    <path class="part star" fill="currentColor" d="${star(64, 64, 21)}"/>
    <path class="part glint" fill="currentColor" d="${star(106, 19, 9)}"/>`;
  const compact = `<path class="part ring-top" fill="none" stroke="currentColor" stroke-width="13" stroke-linecap="round" d="M17.9 77A48 48 0 0 1 101 33.3"/>
    <path class="part ring-bottom" fill="none" stroke="currentColor" stroke-width="13" stroke-linecap="round" d="M112 66A48 48 0 0 1 37.6 104.3"/>
    <path class="part star" fill="currentColor" d="${star(64, 64, 36)}"/>
    <path class="part glint" fill="currentColor" d="${star(110, 16, 11)}"/>`;

  function html(size, { variant = "gather", tone = "brand", label } = {}) {
    const name = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
    return `<svg xmlns="http://www.w3.org/2000/svg" class="ai-mark" viewBox="0 0 128 128" width="${size}" height="${size}" data-variant="${variant}" data-tone="${tone}" ${name}>${size < 28 ? compact : full}</svg>`;
  }

  // Load plays once on insertion. Hover waits for a running gesture instead of cutting it off.
  function play(svg, gesture) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (gesture === "hover" && svg.dataset.play) return;
    svg.removeAttribute("data-play");
    svg.getBoundingClientRect();
    svg.dataset.play = gesture;
    const running = svg.getAnimations({ subtree: true });
    Promise.all(running.map((animation) => animation.finished)).then(() => {
      if (svg.dataset.play === gesture) svg.removeAttribute("data-play");
    }, () => {});
  }

  window.aiMark = { html, play };
})();
