const QUESTION_KEY_PREFIX = "__qk__:";

export function encodeQuestionKey(question: string): string {
  return `${QUESTION_KEY_PREFIX}${encodeURIComponent(question)}`;
}

export function decodeQuestionKey(key: string): string {
  if (!key.startsWith(QUESTION_KEY_PREFIX)) {
    return key;
  }

  const encoded = key.slice(QUESTION_KEY_PREFIX.length);
  try {
    return decodeURIComponent(encoded);
  } catch {
    return key;
  }
}

export function encodeQuestionResponseMap<T>(
  responses: Record<string, T>
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(responses).map(([question, response]) => [
      encodeQuestionKey(question),
      response,
    ])
  );
}

export function decodeQuestionResponseMap<T>(
  responses: Record<string, T>
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(responses).map(([key, response]) => [
      decodeQuestionKey(key),
      response,
    ])
  );
}
