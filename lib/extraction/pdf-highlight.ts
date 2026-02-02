export type TextItemLike = {
  str: string;
};

export type TextItemRange = {
  index: number;
  start: number;
  end: number;
};

export function getTextItemRanges(items: TextItemLike[]): TextItemRange[] {
  let cursor = 0;
  return items.map((item, index) => {
    const start = cursor;
    const end = cursor + item.str.length;
    cursor = end;
    return { index, start, end };
  });
}

export function findIntersectingItems(
  ranges: TextItemRange[],
  charRange: [number, number]
): TextItemRange[] {
  const [start, end] = charRange;
  return ranges.filter((range) => range.end > start && range.start < end);
}
