export type TextItemRange = {
  index: number;
  start: number;
  end: number;
};

export function findIntersectingItems(
  ranges: TextItemRange[],
  charRange: [number, number]
): TextItemRange[] {
  const [start, end] = charRange;
  return ranges.filter((range) => range.end > start && range.start < end);
}
