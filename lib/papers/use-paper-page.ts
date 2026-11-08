"use client";

import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { inWorkspace, useWorkspace } from "@/lib/workspaces/url";
import { useSearchSource } from "@/lib/search/use-search-source";
import { legacyPaperRef, libraryOfPaper, paperPage } from "./paper-ref";

/** Where a paper opens (`paperPage`): a library record's page is on its library, wherever that is now. */
export function usePaperPage(paper: string | undefined, file?: string | null) {
  const workspaceId = useWorkspace();
  const libraryId = paper ? libraryOfPaper(paper) : null;
  const { data: libraryAddress } = useProtectedQuery(api.evidenceLibraries.readers.address, inWorkspace(workspaceId, libraryId ? { libraryId } : "skip"));
  // Nothing opens OpenAlex while our index is what people search.
  const onOpenAlex = useSearchSource() === "openalex";
  if (!paper || (!onOpenAlex && legacyPaperRef(paper)?.source === "openalex")) return null;
  return paperPage(paper, { file, libraryAddress });
}
