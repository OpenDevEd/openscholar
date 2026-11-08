"use client";

import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import useSWRInfinite from "swr/infinite";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "@/lib/workspaces/url";

export type AddedPapersPage = FunctionReturnType<typeof api.evidenceLibraries.assistant.addedPapers>;
export type AddedPaper = AddedPapersPage["papers"][number];
export type AddedPapersSettings = AddedPapersPage["settings"];

/** Papers a page of the list shows. */
export const PAPERS_PER_PAGE = 5;

/**
 * The community's added papers from the community itself, a page of five at a time: page `n` is read after the
 * pages before it, whose cursors lead to it. `read` is false until the community runs.
 */
export function useAddedPapers(libraryId: Id<"evidenceLibraries">, read: boolean) {
  const list = useAction(api.evidenceLibraries.assistant.addedPapers);
  const change = useAction(api.evidenceLibraries.assistant.setAddedPapersSettings);
  // The workspace the person acts in: the community's team reads and changes it from any of theirs.
  const workspaceId = useWorkspace();
  const pages = useSWRInfinite(
    (_, previous: AddedPapersPage | null) =>
      !read || !workspaceId || (previous && !previous.next) ? null : (["added-papers", libraryId, workspaceId, previous?.next ?? null] as const),
    ([, id, workspace, cursor]) => list({ libraryId: id, workspaceId: workspace, cursor, limit: PAPERS_PER_PAGE }),
    { revalidateFirstPage: true, revalidateOnFocus: false },
  );
  const first = pages.data?.[0];
  return {
    pages,
    counts: first?.counts,
    settings: first?.settings,
    /** Reads the list again after papers were added or taken off. */
    refresh: () => pages.mutate(),
    /** Pauses or resumes the source, or turns its PDFs on or off, showing the change while it's sent. */
    setSettings: (next: Partial<AddedPapersSettings>) =>
      pages.mutate(
        async (data) => {
          if (!workspaceId) return data;
          const settings = await change({ libraryId, workspaceId, ...next });
          return data?.map((page, at) => (at === 0 ? { ...page, settings } : page));
        },
        {
          optimisticData: (data) => data?.map((page, at) => (at === 0 ? { ...page, settings: { ...page.settings, ...next } } : page)) ?? [],
          rollbackOnError: true,
          revalidate: false,
        },
      ),
  };
}
