export function deriveChatName(opts: {
  currentQuestion?: string;
  query?: string;
  fallback: string;
}): string {
  const question = opts.currentQuestion?.trim();
  if (question) return question;
  const query = opts.query?.trim();
  if (query) return query;
  return opts.fallback;
}
