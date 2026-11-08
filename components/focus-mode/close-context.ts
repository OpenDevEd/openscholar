import { createContext, useContext } from "react";
import { useUIStore } from "@/lib/store";

/** Closes the focus mode a link sits in, whichever opened it: a page's list or a chat's paper. */
export const FocusModeClose = createContext<(() => void) | null>(null);

/** Closes the focus mode the card sits in, whichever it is, before the card leaves the page. */
export function useCloseFocus() {
  const closeFocus = useContext(FocusModeClose);
  return closeFocus ?? (() => useUIStore.getState().setIsFocusModeOpen(false));
}
