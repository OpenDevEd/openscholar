// Between the About page and a person's page, one portrait travels: the person's whose page is opening or closing. It is
// named for the browser's page transition only for that one move, so nobody else's portrait moves with it, and only when
// both ends of the move are on screen. This runs in the head, before the first paint, where the browser looks for the
// arriving page's half of the move.
(() => {
  const person = (url) => new URL(url).pathname.match(/^\/about\/([^/]+)\/$/)?.[1];
  const carry = (slug, move, mustShow) => {
    const frame = slug && document.querySelector(`[data-portrait="${slug}"]`); if (!frame) return;
    if (mustShow) { const r = frame.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) return; }
    frame.style.viewTransitionName = "portrait"; move.finished.finally(() => { frame.style.viewTransitionName = ""; });
  };
  // Leaving for a person's page: their card here, if it is on screen. Leaving a person's page: the frame at its head, but only
  // when going back to the About page, which returns to where their card is.
  addEventListener("pageswap", (e) => {
    if (!e.viewTransition || !e.activation) return;
    const to = person(e.activation.entry.url), here = person(location.href);
    if (to) carry(to, e.viewTransition, true);
    else if (here && new URL(e.activation.entry.url).pathname === "/about/" && e.activation.navigationType === "traverse") carry(here, e.viewTransition);
  });
  // Arriving on a person's page: the frame at its head. Arriving back on the About page: the card of the person just left.
  addEventListener("pagereveal", (e) => {
    if (!e.viewTransition) return; const a = window.navigation?.activation;
    carry(person(location.href) ?? (a?.navigationType === "traverse" && a.from && person(a.from.url)), e.viewTransition);
  });
  // The way back on a person's page goes back, when the About page is where the visitor came from, so they return to the
  // card they opened and the portrait travels home.
  addEventListener("click", (e) => {
    const back = e.target.closest?.("[data-back]"), nav = window.navigation; if (!back || !nav?.canGoBack || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const before = nav.entries()[nav.currentEntry.index - 1]; if (before && new URL(before.url).pathname === "/about/") { e.preventDefault(); history.back(); }
  });
})();
