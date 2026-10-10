import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};
const yes = () => true;
const no = () => false;

/**
 * False on the server and while this part of the page hydrates, true from the
 * render after. Read what only the browser has (a cookie, storage, the window)
 * once this is true: a first render that differs from the server's fails
 * hydration, and React throws the server's HTML away.
 */
export function useHydrated() {
  return useSyncExternalStore(noSubscription, yes, no);
}
