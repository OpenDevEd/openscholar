// Tabs that show one of several parts: anything with data-i gets .on when its number is picked. Moves on by itself until someone clicks, and waits while pointer or focus is inside.
export function picker(root, every = 5500) {
  const tabs = [...root.querySelectorAll("[data-tabs] [role=tab]")], parts = [...root.querySelectorAll("[data-i]")], calm = matchMedia("(prefers-reduced-motion: reduce)");
  let at = 0, held = false, seen = true;
  const pick = (n, focus) => { at = n; tabs.forEach((t, i) => { t.setAttribute("aria-selected", i === n); t.tabIndex = i === n ? 0 : -1; }); parts.forEach((p) => p.classList.toggle("on", +p.dataset.i === n)); if (focus) tabs[n].focus(); };
  tabs.forEach((t, i) => { t.addEventListener("click", () => { held = true; pick(i); }); t.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") pick(i); }); t.addEventListener("keydown", (e) => { const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (d) { e.preventDefault(); pick((i + d + tabs.length) % tabs.length, true); } }); });
  new IntersectionObserver(([en]) => { seen = en.isIntersecting; }, { threshold: .2 }).observe(root);
  if (every) setInterval(() => { if (!held && seen && !calm.matches && !root.matches(":hover, :focus-within")) pick((at + 1) % tabs.length); }, every);
}
