import type { ChatSourceRow } from "@/convex/chat/chatPapers";

export function stabilizeRowsById(
  _prev: ReadonlyArray<ChatSourceRow> | undefined,
  _next: ReadonlyArray<ChatSourceRow>,
): ChatSourceRow[] {
  return [];
}
