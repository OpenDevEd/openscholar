"use server";

import { paperPageId } from "@/lib/papers/page-address";
import { readAskedPaper, readPaperLists, type PaperLists } from "@/lib/papers/paper-page-data";

/**
 * A paper page's two lists, for a visitor the page ran no searches for (lib/known-visitor.ts). Like the page's own
 * read it spends none of the visitor's requests: Cloudflare answers it only for a browser holding its pass.
 */
export async function readPaperListsLater(id: string): Promise<PaperLists> {
  const paper = await readAskedPaper(paperPageId(id));
  return paper ? readPaperLists(paper) : { similar: [], references: [] };
}
