/** A name as lists order it: ignoring case and accents. Collections and extraction jobs sort by it. */
export function collectionSortName(name: string) {
  return name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}
