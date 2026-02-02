export type PdfTextItem = {
  str: string;
  hasEOL?: boolean;
};

export type PdfTextItemRange = {
  index: number;
  start: number;
  end: number;
};

type BuildOptions = {
  addSpaces?: boolean;
  addNewlines?: boolean;
};

export const DEFAULT_PDFJS_TEXT_OPTIONS: BuildOptions = {
  addSpaces: true,
  addNewlines: true,
};

export function buildPageTextFromItems(
  items: PdfTextItem[],
  options: BuildOptions = DEFAULT_PDFJS_TEXT_OPTIONS
): { text: string; ranges: PdfTextItemRange[] } {
  const addSpaces = options.addSpaces ?? true;
  const addNewlines = options.addNewlines ?? true;
  let text = "";
  const ranges: PdfTextItemRange[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const currentText = item?.str || "";
    const start = text.length;
    text += currentText;
    const end = text.length;
    ranges.push({ index: i, start, end });

    if (addNewlines && item?.hasEOL) {
      text += "\n";
      continue;
    }

    if (!addSpaces) continue;

    const next = items[i + 1];
    if (!next?.str) continue;

    const endsWithSpace = /\s$/.test(currentText);
    const startsWithSpace = /^\s/.test(next.str);
    if (!endsWithSpace && !startsWithSpace) {
      text += " ";
    }
  }

  return { text, ranges };
}
