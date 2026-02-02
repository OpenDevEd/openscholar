export type CitationLocation = {
  page: number;
  charRange: [number, number];
  text: string;
};

export function parseContextChunk(chunk: string): CitationLocation | null {
  if (!chunk) return null;
  const match = chunk.match(/\[Page (\d+), chars (\d+)-(\d+)\]\s*([\s\S]*)/i);
  if (!match) return null;

  const page = Number(match[1]);
  const start = Number(match[2]);
  const end = Number(match[3]);
  if (!Number.isFinite(page) || !Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }

  return {
    page,
    charRange: [start, end],
    text: match[4].trim(),
  };
}
