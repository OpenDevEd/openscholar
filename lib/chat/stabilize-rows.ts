import type { ChatSourceRow } from "@/convex/chat/chatPapers";
import type { Id } from "@/convex/_generated/dataModel";

export function stabilizeRowsById(
  prev: ReadonlyArray<ChatSourceRow> | undefined,
  next: ReadonlyArray<ChatSourceRow>,
): ChatSourceRow[] {
  if (prev === undefined || prev.length === 0) return next.slice();

  const prevById = new Map<Id<"chatPapers">, ChatSourceRow>();
  for (const r of prev) prevById.set(r.chatPaperId, r);

  const out: ChatSourceRow[] = new Array(next.length);
  for (let i = 0; i < next.length; i += 1) {
    const incoming = next[i]!;
    const old = prevById.get(incoming.chatPaperId);
    out[i] = old && rowsStructurallyEqual(old, incoming) ? old : incoming;
  }
  return out;
}

export function rowsStructurallyEqual(
  a: ChatSourceRow,
  b: ChatSourceRow,
): boolean {
  if (a === b) return true;
  return (
    a.chatPaperId === b.chatPaperId &&
    a.sourceId === b.sourceId &&
    a.jobId === b.jobId &&
    a.position === b.position &&
    a.included === b.included &&
    a.sourceType === b.sourceType &&
    a.title === b.title &&
    a.year === b.year &&
    a.doi === b.doi &&
    a.pdfUrl === b.pdfUrl &&
    a.openalexId === b.openalexId &&
    a.abstract === b.abstract &&
    a.bucketKey === b.bucketKey &&
    sameStringArray(a.authors, b.authors)
  );
}

function sameStringArray(
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
