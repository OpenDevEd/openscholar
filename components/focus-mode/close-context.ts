import { createContext } from "react";

/** Closes the focus mode a link sits in, whichever opened it: a page's list or a chat's paper. */
export const FocusModeClose = createContext<(() => void) | null>(null);
