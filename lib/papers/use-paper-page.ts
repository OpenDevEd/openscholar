"use client";

import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { inWorkspace, useWorkspace } from "@/lib/workspaces/url";
import { libraryOfPaper, paperPage } from "./paper-ref";

/** Where a paper opens (`paperPage`): a library record's page is on its library, wherever that is now. */
export function usePaperPage(paper: string | undefined, file?: string | null) {
  const workspaceId = useWorkspace();
  const libraryId = paper ? libraryOfPaper(paper) : null;
  const { data: libraryAddress } = useProtectedQuery(api.evidenceLibraries.readers.address, inWorkspace(workspaceId, libraryId ? { libraryId } : "skip"));
  return paper ? paperPage(paper, { file, libraryAddress }) : null;
}
