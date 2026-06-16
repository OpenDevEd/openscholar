export type StartChatButtonState =
  | { mode: "start" }
  | { mode: "continue"; jobId: string };

export function deriveStartChatButtonState(opts: {
  chatJobIdsByAccountId?: Record<string, string> | null;
  currentAccountId?: string | null;
}): StartChatButtonState {
  const accountId = opts.currentAccountId?.trim();
  if (!accountId) return { mode: "start" };

  const trimmed = opts.chatJobIdsByAccountId?.[accountId]?.trim();
  if (trimmed) return { mode: "continue", jobId: trimmed };
  return { mode: "start" };
}
