const NAVBAR_ICON_ID = /^[A-Za-z0-9]+Icon$/u;

export function isNavbarIconId(value: unknown): value is string {
  return typeof value === "string" && NAVBAR_ICON_ID.test(value);
}

export function hugeiconShard(iconId: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < iconId.length; index += 1) {
    hash ^= iconId.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return ((hash >>> 0) % 64).toString(16).padStart(2, "0");
}

export function hugeiconSpriteUrl(iconId: string): string {
  return `/library-icons/${hugeiconShard(iconId)}.svg#${iconId}`;
}

export function iconDisplayName(iconId: string): string {
  return iconId
    .replace(/Icon$/u, "")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/gu, "$1 $2")
    .replace(/(\d+)/gu, " $1 ")
    .replace(/\s+/gu, " ")
    .trim();
}
