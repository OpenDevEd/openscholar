"use client";

import {
  createContext,
  useContext,
  type PropsWithChildren,
} from "react";

const DeprecatedPaperCitationsContext = createContext(false);

export function DeprecatedPaperCitationsProvider({
  deprecated,
  children,
}: PropsWithChildren<{ deprecated: boolean }>) {
  return (
    <DeprecatedPaperCitationsContext.Provider value={deprecated}>
      {children}
    </DeprecatedPaperCitationsContext.Provider>
  );
}

export function useDeprecatedPaperCitations() {
  return useContext(DeprecatedPaperCitationsContext);
}
