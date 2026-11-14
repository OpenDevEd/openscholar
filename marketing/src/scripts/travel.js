// Between the About page and a person's page, one portrait travels: the person's whose page is opening or closing. It is
// named for the browser's page transition only for that one move, so nobody else's portrait moves with it, and only when
// both ends of the move are on screen. This runs in the head, before the first paint, where the browser looks for the
// arriving page's half of the move.
(() => {
  const person = (url) => new URL(url).pathname.match(/^\/about\/([^/]+)\/$/)?.[1];
  // Whose portrait left on the way out, so the way back knows whether there is a card to return to.
  const left = (slug) => { try { if (slug === undefined) return sessionStorage.getItem("about.left"); sessionStorage.setItem("about.left", slug); } catch {} return ""; };
  const carry = (slug, move, leaving) => {
    const frame = slug && document.querySelector(`[data-portrait="${slug}"]`); if (!frame) return false;
    if (leaving) {
      const r = frame.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) return false;
      // A card under the pointer is lifted, tilted and lit. It is set flat first, so the picture that leaves is the one that arrives.
      frame.dataset.going = ""; frame.style.removeProperty("--tx"); frame.style.removeProperty("--ty");
    }
    frame.style.viewTransitionName = "portrait"; move.finished.finally(() => { frame.style.viewTransitionName = ""; delete frame.dataset.going; });
    return true;
  };
  // Leaving for a person's page: their card here, if it is on screen. Leaving a person's page: the frame at its head, but only
  // when going back to the About page that their card left from.
  addEventListener("pageswap", (e) => {
    if (!e.viewTransition || !e.activation) return;
    const to = person(e.activation.entry.url), here = person(location.href);
    if (to) left(carry(to, e.viewTransition, true) ? to : "");
    else if (here && new URL(e.activation.entry.url).pathname === "/about/" && e.activation.navigationType === "traverse" && left() === here) carry(here, e.viewTransition, true);
  });
  // Arriving on a person's page: the frame at its head. Arriving back on the About page: the card of the person just left.
  // A page come back to has been seen, so it is marked: its entrances don't play again, and it is uncovered, not laid over.
  addEventListener("pagereveal", (e) => {
    const a = window.navigation?.activation, back = a?.navigationType === "traverse";
    if (back) document.documentElement.classList.add("back");
    if (!e.viewTransition) return;
    if (back) e.viewTransition.types?.add("back");
    carry(person(location.href) ?? (back && a.from && person(a.from.url)), e.viewTransition);
  });
  // The way back on a person's page goes back, when the About page is where the visitor came from, so they return to the
  // card they opened and the portrait travels home.
  addEventListener("click", (e) => {
    const back = e.target.closest?.("[data-back]"), nav = window.navigation; if (!back || !nav?.canGoBack || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const before = nav.entries()[nav.currentEntry.index - 1]; if (before && new URL(before.url).pathname === "/about/") { e.preventDefault(); history.back(); }
  });
})();
