// Between the About pages, one picture of a person travels: the one in the link that opened their page (their card in the
// team list, their face in a place's list or beside an organisation), to the frame at the head of their page, and back to
// the same one. It is named for the browser's page transition only for that one move, so nobody else's picture moves with
// it, and only when there is a picture in the window for it to land on. This runs in the head, before the first paint,
// where the browser looks for the arriving page's half of the move.
(() => {
  const person = (url) => new URL(url).pathname.match(/^\/about\/([^/]+)\/$/)?.[1];
  // Every picture of a person on this page that can travel, in the page's own order: on their own page the first is the
  // frame at its head.
  const frames = (slug) => [...document.querySelectorAll(`[data-portrait="${slug}"]`)];
  // Whose picture left on the way out and which of theirs it was ("slug:2"), so the way back returns it to the same one.
  const left = (note) => { try { if (note === undefined) return sessionStorage.getItem("about.left") || ""; sessionStorage.setItem("about.left", note); } catch {} return ""; };
  // The picture in the link that was last clicked: the one that leaves.
  let clicked = null;
  const carry = (frame, move, leaving) => {
    // Only a picture that can be seen travels: a card still hidden by its row's entrance, or a face in a place that is
    // shut, would appear from nothing.
    if (!frame || frame.checkVisibility?.({ opacityProperty: true }) === false) return false;
    const r = frame.getBoundingClientRect(), above = r.bottom < 0, out = above || r.top > innerHeight;
    if (leaving) {
      // A card under the pointer is lifted, tilted and lit. It is set flat first, so the picture that leaves is the one that arrives.
      frame.dataset.going = ""; frame.style.removeProperty("--tx"); frame.style.removeProperty("--ty");
      // One the visitor has scrolled away from still leaves: from the window's edge, where it would come into view.
      if (out) frame.style.translate = `0 ${above ? -r.bottom : innerHeight - r.top}px`;
    } else {
      // An arriving picture has to be in the window: a page loaded afresh may not be scrolled back to it yet, and the
      // picture would fly to where it isn't.
      if (out) return false;
      // The frame that arrives may not have its photo yet: a browser often has to ask for a picture again on a new page.
      // Until it is in, the picture that travels stays the one that left, whole (html.waiting, about.css), and the two
      // change over only then. The photo doesn't fade in by itself meanwhile (data-arriving), so the person never dims on
      // the way.
      const who = frame.querySelector(".pf-who"), html = document.documentElement; frame.dataset.arriving = "";
      // Landing on a small round face, the change-over waits until the move has nearly shrunk to it (about.css).
      if (frame.matches("img")) move.types?.add("to-face");
      if (who && !("landed" in who.dataset)) {
        const over = () => { landed.disconnect(); if (html.waitsFor === move) html.classList.remove("waiting"); }, landed = new MutationObserver(over);
        html.waitsFor = move; html.classList.add("waiting"); landed.observe(who, { attributes: true, attributeFilter: ["data-landed"] }); move.finished.finally(over);
      }
    }
    // What a move set, it clears, unless a later move has taken the frame over since.
    frame.move = move; frame.style.viewTransitionName = "portrait";
    move.finished.finally(() => { if (frame.move !== move) return; frame.style.viewTransitionName = frame.style.translate = ""; delete frame.dataset.going; delete frame.dataset.arriving; });
    return true;
  };
  // Leaving for a person's page: their picture in the link that was clicked, or without a click (the browser's Forward) the
  // first of theirs on screen. Leaving a person's page: the frame at its head, but only when going back to the About page
  // that their picture left from. What left is noted on every way out, with or without a transition, so a note from an
  // earlier move never names a picture on a page that sent nothing.
  addEventListener("pageswap", (e) => {
    const move = e.viewTransition, to = e.activation?.entry.url, here = person(location.href), was = left(); let note = "";
    if (move && to) {
      const slug = person(to), all = slug ? frames(slug) : [];
      if (slug) { const from = [clicked, ...all].find((f) => f?.dataset.portrait === slug && carry(f, move, true)); if (from) note = `${slug}:${all.indexOf(from)}`; }
      else if (here && new URL(to).pathname === "/about/" && e.activation.navigationType === "traverse" && e.activation.entry.index < (window.navigation?.currentEntry?.index ?? Infinity) && was.split(":")[0] === here && carry(frames(here)[0], move, true)) note = was;
    }
    left(note);
  });
  // A page reached through the history has been seen, so it is marked (the class says back for forward too): its entrances
  // don't play again. It is marked as the page is read, which every browser does, and again when a kept page is shown.
  const seen = () => {
    const a = window.navigation?.activation, was = a ? a.navigationType === "traverse" : performance.getEntriesByType("navigation")[0]?.type === "back_forward";
    if (was) document.documentElement.classList.add("back");
    return was && !!a?.from && a.entry.index < a.from.index && a;
  };
  seen();
  // A page kept by the browser and shown again has been seen too, and its load's own record can't say so. It also comes
  // back with the browser still holding the pointer where it was when the page was left: the card that was clicked counts
  // as hovered, and would lift and light up again by itself once its portrait had landed. So such a page is cold until the
  // pointer really moves, and the hover looks on these pages wait for that (html.cold).
  addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    const html = document.documentElement; html.classList.add("back", "cold");
    addEventListener("pointermove", () => html.classList.remove("cold"), { once: true });
  });
  // Arriving on a person's page: the frame at its head. Arriving back on the About page: the picture that left, of the
  // person just left. Either only when the page being left sent its half, or the frame would fade in alone on top of that
  // page. Any page the transition brings in is marked (moved), so the frame at a person's head doesn't rise in under the
  // picture travelling to it. Everything else makes its entrance as on any other page.
  addEventListener("pagereveal", (e) => {
    const back = seen(), html = document.documentElement; if (!e.viewTransition) return;
    html.classList.add("moved");
    // Back on the About page the picture lands where it left from. If that one can't take it (the page was loaded afresh,
    // and the place it was listed in is shut again), another of the person's pictures does. With nowhere on screen to
    // land, the move is cut short, as the picture would otherwise fade out alone where it left.
    const here = person(location.href), slug = here ?? (back && person(back.from.url)), [was, n] = left().split(":");
    if (!slug || was !== slug) return;
    const all = frames(slug);
    if (![all[here ? 0 : +n], ...(here ? [] : all)].some((frame) => carry(frame, e.viewTransition))) e.viewTransition.skipTransition();
  });
  // The way back on a person's page goes back, when the About page is where the visitor came from, so they return to the
  // link they opened and the picture travels home.
  addEventListener("click", (e) => {
    clicked = e.target.closest?.("a")?.querySelector("[data-portrait]") ?? null;
    const back = e.target.closest?.("[data-back]"), nav = window.navigation; if (!back || e.metaKey || e.ctrlKey || e.shiftKey) return;
    // Where the browser can't say what the entry before this one is, the page that linked here stands in for it.
    const before = nav ? nav.canGoBack && nav.entries()[nav.currentEntry.index - 1]?.url : history.length > 1 && document.referrer;
    if (before && new URL(before).pathname === "/about/") { e.preventDefault(); history.back(); }
  });
})();
