export function formatNumber(num: number, locale?: string): string {
  const browserLocale = locale || (typeof navigator !== 'undefined' ? navigator.language : 'en-US');
  
  if (num >= 1000) {
    return new Intl.NumberFormat(browserLocale, {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(num);
  }
  
  return new Intl.NumberFormat(browserLocale).format(num);
}

export function formatTimeAgo(date: string | Date, locale?: string): string {
  const now = new Date();
  const past = new Date(date);
  const diffInSeconds = Math.floor((now.getTime() - past.getTime()) / 1000);
  
  const userLocale = locale || (typeof navigator !== 'undefined' ? navigator.language : 'en-US');
  const rtf = new Intl.RelativeTimeFormat(userLocale, { numeric: 'auto', style: 'short' });
  
  const intervals = [
    { unit: 'year', seconds: 31536000 },
    { unit: 'month', seconds: 2592000 },
    { unit: 'week', seconds: 604800 },
    { unit: 'day', seconds: 86400 },
    { unit: 'hour', seconds: 3600 },
    { unit: 'minute', seconds: 60 },
  ];
  
  for (const interval of intervals) {
    const count = Math.floor(Math.abs(diffInSeconds) / interval.seconds);
    if (count >= 1) {
      return rtf.format(-Math.sign(diffInSeconds) * count, interval.unit as Intl.RelativeTimeFormatUnit);
    }
  }
  
  return rtf.format(0, 'second');
}

const COLOR_PALETTE = [
  { 
    bg: 'oklch(0.97 0.04 25)', 
    text: 'oklch(0.45 0.18 25)', 
    border: 'oklch(0.88 0.06 25)', 
    dot: 'oklch(0.60 0.20 25)' 
  },
  { 
    bg: 'oklch(0.97 0.06 55)', 
    text: 'oklch(0.45 0.18 45)', 
    border: 'oklch(0.88 0.08 45)', 
    dot: 'oklch(0.62 0.20 45)' 
  },
  { 
    bg: 'oklch(0.97 0.08 85)', 
    text: 'oklch(0.45 0.16 75)', 
    border: 'oklch(0.88 0.10 75)', 
    dot: 'oklch(0.60 0.18 75)' 
  },
  { 
    bg: 'oklch(0.97 0.08 135)', 
    text: 'oklch(0.45 0.16 135)', 
    border: 'oklch(0.88 0.10 135)', 
    dot: 'oklch(0.58 0.18 135)' 
  },
  { 
    bg: 'oklch(0.97 0.07 160)', 
    text: 'oklch(0.42 0.15 160)', 
    border: 'oklch(0.88 0.09 160)', 
    dot: 'oklch(0.55 0.17 160)' 
  },
  { 
    bg: 'oklch(0.97 0.06 190)', 
    text: 'oklch(0.42 0.14 190)', 
    border: 'oklch(0.88 0.08 190)', 
    dot: 'oklch(0.55 0.16 190)' 
  },
  { 
    bg: 'oklch(0.97 0.06 220)', 
    text: 'oklch(0.42 0.14 220)', 
    border: 'oklch(0.88 0.08 220)', 
    dot: 'oklch(0.55 0.16 220)' 
  },
  { 
    bg: 'oklch(0.97 0.08 255)', 
    text: 'oklch(0.42 0.16 255)', 
    border: 'oklch(0.88 0.10 255)', 
    dot: 'oklch(0.55 0.18 255)' 
  },
  { 
    bg: 'oklch(0.97 0.08 280)', 
    text: 'oklch(0.42 0.16 280)', 
    border: 'oklch(0.88 0.10 280)', 
    dot: 'oklch(0.55 0.18 280)' 
  },
  { 
    bg: 'oklch(0.97 0.08 310)', 
    text: 'oklch(0.45 0.16 310)', 
    border: 'oklch(0.88 0.10 310)', 
    dot: 'oklch(0.58 0.18 310)' 
  },
  { 
    bg: 'oklch(0.97 0.08 340)', 
    text: 'oklch(0.48 0.16 340)', 
    border: 'oklch(0.88 0.10 340)', 
    dot: 'oklch(0.62 0.18 340)' 
  },
  { 
    bg: 'oklch(0.97 0.08 20)', 
    text: 'oklch(0.50 0.18 20)', 
    border: 'oklch(0.88 0.10 20)', 
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
