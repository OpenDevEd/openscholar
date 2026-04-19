"use client";

import { createContext, useContext } from "react";

import type { Id } from "@/convex/_generated/dataModel";
import type { ResolvablePaper } from "@/lib/chat/resolve-paper";

export interface PapersContextValue {
  papersByPosition: ReadonlyMap<number, ResolvablePaper>;
  jobId: Id<"extractionJobs">;
}

export const PapersContext = createContext<PapersContextValue | null>(null);

export function usePapersContext(): PapersContextValue {
  const ctx = useContext(PapersContext);
  if (!ctx) {
    throw new Error(
      "usePapersContext must be used within <PapersContext.Provider>",
    );
  }
  return ctx;
}
