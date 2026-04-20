import type { ChatSourceRow } from "@/convex/chat/chatPapers";

export function stabilizeRowsById(
  prev: ReadonlyArray<ChatSourceRow> | undefined,
  next: ReadonlyArray<ChatSourceRow>,
): ChatSourceRow[] {
  if (prev === undefined || prev.length === 0) return next.slice();
  return [];
}
