const ESCAPED_SAFE_TAG_RE =
  /&lt;\s*(\/?)\s*(sub|sup)\b(?:(?!&gt;)[\s\S])*?&gt;/gi;
const BACKSLASH_ESCAPED_SAFE_TAG_RE = /<\s*(\/?)\s*(sub|sup)\s*\\+\s*>/gi;
const SAFE_RENDER_TAG_RE = /<\/?(?:sub|sup)>/gi;
const THEMATIC_BREAK_LINE_RE =
  /^[ \t]{0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/gm;

function decodeEscapedSafeScholarlyTags(markdown: string): string {
  return markdown
    .replace(ESCAPED_SAFE_TAG_RE, (_match, closing, tag) => {
      const normalizedTag = String(tag).toLowerCase();
      return closing ? `</${normalizedTag}>` : `<${normalizedTag}>`;
    })
    .replace(BACKSLASH_ESCAPED_SAFE_TAG_RE, (_match, closing, tag) => {
      const normalizedTag = String(tag).toLowerCase();
      return closing ? `</${normalizedTag}>` : `<${normalizedTag}>`;
    });
}

function countExactDelimiterRuns(
  text: string,
  marker: "*" | "_",
  length: number,
): number {
  const run = marker.repeat(length);
  let count = 0;
  for (let i = 0; i <= text.length - length; i++) {
    if (!text.startsWith(run, i)) continue;
    if (text[i - 1] === marker || text[i + length] === marker) continue;
    count += 1;
    i += length - 1;
  }
  return count;
}

function stripDanglingTerminalEmphasis(markdown: string): string {
  const match = markdown.match(/([*_]{1,3})[ \t]*$/);
  if (!match?.index) return markdown;

  const run = match[1];
  const marker = run[0] as "*" | "_";
  const prefix = markdown.slice(0, match.index);

  if (countExactDelimiterRuns(prefix, marker, run.length) % 2 === 1) {
    return `${prefix}${run}`;
  }

  return prefix.trimEnd();
}

export function normalizeChatMarkdownForRender(markdown: string): string {
  return stripDanglingTerminalEmphasis(
    decodeEscapedSafeScholarlyTags(markdown),
  );
}

export function normalizeChatMarkdownForClipboard(markdown: string): string {
  return normalizeChatMarkdownForRender(markdown)
    .replace(THEMATIC_BREAK_LINE_RE, "")
    .replace(SAFE_RENDER_TAG_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
