/**
 * A JPEG's width and height, read from its frame header (the first SOF segment) without decoding it; null for bytes
 * that aren't a JPEG or hold no frame header.
 */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 8 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1]!;
    // Padding between segments, and markers that stand alone with no length.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    // SOF0 to SOF15, which aren't DHT (C4), JPG (C8) or DAC (CC): precision, then height and width.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[at + 5]! << 8) | bytes[at + 6]!, width: (bytes[at + 7]! << 8) | bytes[at + 8]! };
    }
    at += 2 + ((bytes[at + 2]! << 8) | bytes[at + 3]!);
  }
  return null;
}
