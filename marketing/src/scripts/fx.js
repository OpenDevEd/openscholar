// The header, its menus and the pointer effects. Everything here is an extra: every link works without it.
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const top = $(".top"), mega = $("[data-mega]"), nav = $(".nav"), pill = $(".pill"), fine = matchMedia("(hover: hover) and (pointer: fine)").matches, still = matchMedia("(prefers-reduced-motion: reduce)");

// The bar turns to glass once the page has moved under it.
const mark = () => top.classList.toggle("stuck", scrollY > 24);
addEventListener("scroll", mark, { passive: true }); mark();

// The header follows the page: the section you're reading takes the name's place, and its bar along the capsule's edge fills as you go.
const secName = $("[data-sec]"), rail = $$("[data-to]"), targets = rail.map((a) => document.getElementById(a.dataset.to));
if (rail.length) { let raf = 0, active = -1; const spy = () => { raf = 0; const mid = innerHeight * .45; let now = -1; targets.forEach((t, i) => { const r = t.getBoundingClientRect(); const p = r.top >= mid ? 0 : r.bottom <= mid ? 1 : (mid - r.top) / r.height; rail[i].style.setProperty("--p", p.toFixed(3)); if (r.top < mid && r.bottom > mid) now = i; }); if (now !== active) { active = now; top.classList.toggle("has-sec", now >= 0); if (now >= 0) secName.textContent = rail[now].dataset.label; } }; addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(spy); }, { passive: true }); addEventListener("resize", spy, { passive: true }); spy(); }

// One highlight slides between the links.
const links = $$(".lk", nav);
const slide = (a) => { pill.style.setProperty("--px", `${a.offsetLeft}px`); pill.style.setProperty("--pw", `${a.offsetWidth}px`); pill.style.opacity = 1; };

// One panel changes shape between menus. Wait a moment before opening so a passing pointer doesn't trigger it, and move straight between menus once it's open.
let openTimer, closeTimer, current = null;
const subs = $$("[data-sub]", mega);
const showRow = (sub, i) => { const rows = $$(".row", sub); rows.forEach((r, n) => r.classList.toggle("on", n === i)); $$(".st", sub).forEach((s, n) => s.classList.toggle("on", n === i)); const hl = $(".hl", sub); if (hl) { hl.style.setProperty("--hy", `${rows[i].offsetTop}px`); hl.style.setProperty("--hh", `${rows[i].offsetHeight}px`); } };
function open(a) {
  const id = a.dataset.menu, sub = subs.find((s) => s.dataset.sub === id);
  $$("img[data-src]", sub).forEach((i) => { i.src = i.dataset.src; delete i.dataset.src; });
  if (!sub.dataset.ready) { showRow(sub, 0); sub.dataset.ready = "1"; }
  subs.forEach((s) => { const on = s === sub; if (on) s.style.setProperty("--from", "0px"); else s.style.setProperty("--from", `${subs.indexOf(s) < subs.indexOf(sub) ? -24 : 24}px`); s.toggleAttribute("data-on", on); s.inert = !on; });
  const pad = parseFloat(getComputedStyle(top).paddingLeft), box = top.getBoundingClientRect(), r = a.getBoundingClientRect(), w = sub.offsetWidth, h = sub.offsetHeight, room = top.clientWidth - 2 * pad;
  const x = Math.max(0, Math.min(r.left + r.width / 2 - box.left - pad - w / 2, room - w));
  mega.style.cssText = `--w:${w}px;--h:${h}px;--x:${x}px`;
  mega.toggleAttribute("data-open", true); links.forEach((l) => l.classList.toggle("on", l === a)); current = id; slide(a);
}
function close() { mega.removeAttribute("data-open"); links.forEach((l) => l.classList.remove("on")); current = null; pill.style.opacity = 0; subs.forEach((s) => { s.removeAttribute("data-on"); s.inert = true; }); }
for (const a of links) {
  a.addEventListener("pointerenter", (e) => { if (e.pointerType === "touch") return; clearTimeout(closeTimer); clearTimeout(openTimer); slide(a); if (current) open(a); else openTimer = setTimeout(() => open(a), 250); });
  a.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { e.preventDefault(); open(a); $("a", subs.find((s) => s.dataset.sub === a.dataset.menu))?.focus(); } });
}
nav.addEventListener("pointerleave", () => { clearTimeout(openTimer); if (!current) pill.style.opacity = 0; });
top.addEventListener("pointerleave", () => { clearTimeout(openTimer); if (!mega.contains(document.activeElement)) closeTimer = setTimeout(close, 80); });
top.addEventListener("pointerenter", () => clearTimeout(closeTimer));
mega.addEventListener("pointerover", (e) => { const row = e.target.closest("[data-row]"); if (row) showRow(row.closest("[data-sub]"), +row.dataset.row); });
mega.addEventListener("focusin", (e) => { const row = e.target.closest("[data-row]"); if (row) showRow(row.closest("[data-sub]"), +row.dataset.row); });
mega.addEventListener("click", (e) => { if (e.target.closest("a")) close(); });
top.addEventListener("focusout", (e) => { if (current && !top.contains(e.relatedTarget)) close(); });
addEventListener("keydown", (e) => { if (e.key === "Escape" && current) { const a = links.find((l) => l.dataset.menu === current); close(); a?.focus(); } });

// Phone menu.
const menu = $(".menu");
addEventListener("click", (e) => { if (menu?.open && (!menu.contains(e.target) || e.target.closest(".sheet a, .sheet button"))) menu.open = false; });
addEventListener("keydown", (e) => { if (e.key === "Escape" && menu?.open) { menu.open = false; $("summary", menu).focus(); } });

// The question box behind the header's search button, and its shortcut.
const dialog = $("[data-dialog]"), mac = /Mac|iPhone|iPad/.test(navigator.platform);
if (!mac) $$("[data-key]").forEach((k) => (k.textContent = "Ctrl K"));
const ask = () => { close(); dialog.showModal(); $("input", dialog).focus(); };
$$("[data-palette]").forEach((b) => b.addEventListener("click", ask));
addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); dialog.open ? dialog.close() : ask(); } });
dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
$$("[data-try]", dialog).forEach((b) => b.addEventListener("click", () => { $("input", dialog).value = b.dataset.try; $("form", dialog).requestSubmit(); }));

// Pointer effects on real mice and trackpads only.
if (fine) {
  const bar = $(".bar"); bar.addEventListener("pointermove", (e) => bar.style.setProperty("--bx", `${e.clientX - bar.getBoundingClientRect().left}px`), { passive: true });
  let frame = 0, last;
  addEventListener("pointermove", (e) => {
    last = e;
    if (frame || still.matches) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const t = last.target, spot = t.closest?.(".panel, .spot, [data-spot]");
      if (spot) { const r = spot.getBoundingClientRect(); const x = last.clientX - r.left, y = last.clientY - r.top; spot.style.setProperty("--mx", `${x}px`); spot.style.setProperty("--my", `${y}px`); if (spot.matches("[data-spot]")) { const w = $(".word", spot), wr = w.getBoundingClientRect(); w.style.setProperty("--mx", `${last.clientX - wr.left}px`); w.style.setProperty("--my", `${last.clientY - wr.top}px`); } }
      const hero = t.closest?.(".hero"); if (hero) { hero.style.setProperty("--hx", (last.clientX / innerWidth - .5).toFixed(3)); hero.style.setProperty("--hy", (last.clientY / innerHeight - .5).toFixed(3)); }
      const tilt = t.closest?.("[data-tilt]");
      if (tilt) { const r = tilt.getBoundingClientRect(), x = (last.clientX - r.left) / r.width - .5, y = (last.clientY - r.top) / r.height - .5; tilt.style.transform = `perspective(1400px) rotateX(${(-y * 4).toFixed(2)}deg) rotateY(${(x * 5).toFixed(2)}deg) translateZ(0)`; tilt.style.setProperty("--sx", `${(x + .5) * 100}%`); tilt.style.setProperty("--sy", `${(y + .5) * 100}%`); }
    });
  }, { passive: true });
  still.addEventListener("change", () => $$("[data-tilt]").forEach((t) => (t.style.transform = "")));
  document.addEventListener("pointerout", (e) => { const tilt = e.target.closest?.("[data-tilt]"); if (tilt && !tilt.contains(e.relatedTarget)) tilt.style.transform = ""; });
}

// Move across a device to wipe it between its light and dark screens.
for (const d of $$("[data-wipe]")) d.parentElement.addEventListener("pointermove", (e) => { const r = $(".glass", d).getBoundingClientRect(), box = d.parentElement; box.classList.add("held"); box.style.setProperty("--w", `${Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)).toFixed(1)}%`); }, { passive: true });

// The art moves once the page is idle, and only where there's a real pointer and a real graphics card to spare.
if (fine && !still.matches && $("[data-live]")) (window.requestIdleCallback || setTimeout)(() => import("./live.js"));

// Entrances: each section gets one deliberate move as it arrives, once.
const inView = $$("[data-in]");
if (inView.length) { const io = new IntersectionObserver((list) => { for (const en of list) if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } }, { threshold: .2, rootMargin: "0px 0px -8% 0px" }); inView.forEach((el) => io.observe(el)); }
