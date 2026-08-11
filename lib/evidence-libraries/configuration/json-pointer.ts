export function escapeJsonPointerToken(token: string): string {
  return token.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function unescapeJsonPointerToken(token: string): string {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

export function jsonPointerPatternMatches(
  pattern: string,
  pointer: string,
): boolean {
  const patternTokens = pattern.split("/");
  const pointerTokens = pointer.split("/");
  return (
    patternTokens.length === pointerTokens.length &&
    patternTokens.every(
      (token, index) => token === "*" || token === pointerTokens[index],
    )
  );
}
