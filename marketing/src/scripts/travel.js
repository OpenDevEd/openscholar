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
  // when going back to the About page that their card left from. What left is noted on every way out, with or without a
  // transition, so a note from an earlier move never names a frame on a page that sent nothing.
  addEventListener("pageswap", (e) => {
    const move = e.viewTransition, to = e.activation?.entry.url, here = person(location.href); let went = "";
    if (move && to) {
      if (person(to)) went = person(to);
      else if (here && new URL(to).pathname === "/about/" && e.activation.navigationType === "traverse" && e.activation.entry.index < (window.navigation?.currentEntry?.index ?? Infinity) && left() === here) went = here;
    }
    left(went && carry(went, move, true) ? went : "");
  });
  // A page reached through the history has been seen, so it is marked (the class says back for forward too): its entrances
  // don't play again. It is marked as the page is read, which every browser does, and again when a kept page is shown.
  const seen = () => {
    const a = window.navigation?.activation, was = a ? a.navigationType === "traverse" : performance.getEntriesByType("navigation")[0]?.type === "back_forward";
    if (was) document.documentElement.classList.add("back");
    return was && !!a?.from && a.entry.index < a.from.index && a;
  };
  seen();
  // Arriving on a person's page: the frame at its head. Arriving back on the About page: the card of the person just left.
  // Either only when the page being left sent its half, or the frame would fade in alone on top of that page. A page whose
  // frame was carried in is marked, so the frame makes no entrance of its own, and so is any page the transition brings in,
  // as that move is its entrance. Going back, the page is uncovered, not laid over.
  addEventListener("pagereveal", (e) => {
    const back = seen(); if (!e.viewTransition) return;
    document.documentElement.classList.add("moved");
    if (back) e.viewTransition.types?.add("back");
    const slug = person(location.href) ?? (back && person(back.from.url)); if (slug && left() === slug && carry(slug, e.viewTransition)) document.documentElement.classList.add("carried");
  });
  // The way back on a person's page goes back, when the About page is where the visitor came from, so they return to the
  // card they opened and the portrait travels home.
  addEventListener("click", (e) => {
    const back = e.target.closest?.("[data-back]"), nav = window.navigation; if (!back || e.metaKey || e.ctrlKey || e.shiftKey) return;
    // Where the browser can't say what the entry before this one is, the page that linked here stands in for it.
    const before = nav ? nav.canGoBack && nav.entries()[nav.currentEntry.index - 1]?.url : history.length > 1 && document.referrer;
    if (before && new URL(before).pathname === "/about/") { e.preventDefault(); history.back(); }
  });
})();
