const COLOR_PALETTE = [
  {
    bg: 'light-dark(oklch(0.97 0.04 25), oklch(0.22 0.05 25))',
    text: 'light-dark(oklch(0.45 0.18 25), oklch(0.82 0.1 25))',
    border: 'light-dark(oklch(0.88 0.06 25), oklch(0.32 0.07 25))',
    dot: 'oklch(0.60 0.20 25)'
  },
  {
    bg: 'light-dark(oklch(0.97 0.06 55), oklch(0.22 0.05 55))',
    text: 'light-dark(oklch(0.45 0.18 45), oklch(0.82 0.1 45))',
    border: 'light-dark(oklch(0.88 0.08 45), oklch(0.32 0.07 45))',
    dot: 'oklch(0.62 0.20 45)'
  },
  {
    bg: 'light-dark(oklch(0.97 0.08 85), oklch(0.22 0.05 85))',
    text: 'light-dark(oklch(0.45 0.16 75), oklch(0.82 0.1 75))',
    border: 'light-dark(oklch(0.88 0.10 75), oklch(0.32 0.07 75))',
    dot: 'oklch(0.60 0.18 75)'
  },
  {
    bg: 'light-dark(oklch(0.97 0.08 135), oklch(0.22 0.05 135))',
    text: 'light-dark(oklch(0.45 0.16 135), oklch(0.82 0.1 135))',
    border: 'light-dark(oklch(0.88 0.10 135), oklch(0.32 0.07 135))',
    dot: 'oklch(0.58 0.18 135)'
  },
  {
    bg: 'light-dark(oklch(0.97 0.07 160), oklch(0.22 0.05 160))',
    text: 'light-dark(oklch(0.42 0.15 160), oklch(0.82 0.1 160))',
    border: 'light-dark(oklch(0.88 0.09 160), oklch(0.32 0.07 160))',
    dot: 'oklch(0.55 0.17 160)'
  },
  {
    bg: 'light-dark(oklch(0.97 0.06 190), oklch(0.22 0.05 190))',
    text: 'light-dark(oklch(0.42 0.14 190), oklch(0.82 0.1 190))',
    border: 'light-dark(oklch(0.88 0.08 190), oklch(0.32 0.07 190))',
    dot: 'oklch(0.55 0.16 190)'
  },
  {
    bg: 'light-dark(oklch(0.97 0.06 220), oklch(0.22 0.05 220))',
    text: 'light-dark(oklch(0.42 0.14 220), oklch(0.82 0.1 220))',
    border: 'light-dark(oklch(0.88 0.08 220), oklch(0.32 0.07 220))',
    dot: 'oklch(0.55 0.16 220)'
  },
  {
    bg: 'light-dark(oklch(0.97 0.08 255), oklch(0.22 0.05 255))',
    text: 'light-dark(oklch(0.42 0.16 255), oklch(0.82 0.1 255))',
    border: 'light-dark(oklch(0.88 0.10 255), oklch(0.32 0.07 255))',
    dot: 'oklch(0.55 0.18 255)'
  },
  {
    bg: 'light-dark(oklch(0.97 0.08 280), oklch(0.22 0.05 280))',
    text: 'light-dark(oklch(0.42 0.16 280), oklch(0.82 0.1 280))',
    border: 'light-dark(oklch(0.88 0.10 280), oklch(0.32 0.07 280))',
    dot: 'oklch(0.55 0.18 280)'
  },
  {
    bg: 'light-dark(oklch(0.97 0.08 310), oklch(0.22 0.05 310))',
    text: 'light-dark(oklch(0.45 0.16 310), oklch(0.82 0.1 310))',
    border: 'light-dark(oklch(0.88 0.10 310), oklch(0.32 0.07 310))',
    dot: 'oklch(0.58 0.18 310)'
  },
  {
    bg: 'light-dark(oklch(0.97 0.08 340), oklch(0.22 0.05 340))',
    text: 'light-dark(oklch(0.48 0.16 340), oklch(0.82 0.1 340))',
    border: 'light-dark(oklch(0.88 0.10 340), oklch(0.32 0.07 340))',
    dot: 'oklch(0.62 0.18 340)'
  },
  {
    bg: 'light-dark(oklch(0.97 0.08 20), oklch(0.22 0.05 20))',
    text: 'light-dark(oklch(0.50 0.18 20), oklch(0.82 0.1 20))',
    border: 'light-dark(oklch(0.88 0.10 20), oklch(0.32 0.07 20))',
    dot: 'oklch(0.65 0.20 20)'
  },
] as const;

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash;
}

export function getIdColor(id: string) {
  const hash = hashString(id);
  const index = Math.abs(hash) % COLOR_PALETTE.length;
  return COLOR_PALETTE[index];
}
