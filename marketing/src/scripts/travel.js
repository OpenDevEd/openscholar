// Between the About page and a person's page, one portrait travels: the person's whose page is opening or closing. It is
// named for the browser's page transition only for that one move, so nobody else's portrait moves with it. This runs in
// the head, before the first paint, where the browser looks for the arriving page's half of the move.
(() => {
  const person = (url) => new URL(url).pathname.match(/^\/about\/([^/]+)\/$/)?.[1];
  const carry = (slug, move) => {
    const frame = slug && document.querySelector(`[data-portrait="${slug}"]`); if (!frame) return;
    frame.style.viewTransitionName = "portrait"; move.finished.finally(() => { frame.style.viewTransitionName = ""; });
  };
  // Leaving: towards a person's page it's their card here, and away from one it's the frame at its head.
  addEventListener("pageswap", (e) => { if (e.viewTransition && e.activation) carry(person(e.activation.entry.url) ?? person(location.href), e.viewTransition); });
  // Arriving: on a person's page it's the frame at its head, and back on the About page it's the card of the person just left.
  addEventListener("pagereveal", (e) => { if (!e.viewTransition) return; const from = window.navigation?.activation?.from?.url; carry(person(location.href) ?? (from && person(from)), e.viewTransition); });
})();
