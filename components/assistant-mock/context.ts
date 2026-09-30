"use client";

// State the pages beside the assistant render from, the way a Convex record would
// feed them. The assistant changes it; the pages only read it and offer undo.

import { createContext, useContext } from "react";
import type { PageState } from "./results-pane";

export type LibraryState = {
  tagline: string;
  description: string;
  collections: string[];
  /** Fields the assistant just changed glow until this clears. */
  highlight: boolean;
  changed: boolean;
  status: "draft" | "publishing" | "live";
};

export const LIBRARY_START: LibraryState = {
  tagline: "",
  description: "",
  collections: [],
  highlight: false,
  changed: false,
  status: "draft",
};

export type MockValue = {
  page: PageState;
  library: LibraryState;
  undoSearch: () => void;
  undoLibrary: () => void;
};

export const MockContext = createContext<MockValue | null>(null);

export function useMock() {
  const value = useContext(MockContext);
  if (!value) throw new Error("useMock needs the assistant mock layout");
  return value;
}
