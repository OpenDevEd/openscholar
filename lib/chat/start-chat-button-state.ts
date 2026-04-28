export type StartChatButtonState =
  | { mode: "start" }
  | { mode: "continue"; jobId: string };

export function deriveStartChatButtonState(opts: {
  chatJobId?: string | null;
}): StartChatButtonState {
  const trimmed = opts.chatJobId?.trim();
  if (trimmed) return { mode: "continue", jobId: trimmed };
  return { mode: "start" };
}
