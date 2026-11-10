// The country a place's name ends in, for an institution OpenAlex's lookup describes as "Accra, Ghana".
import { COUNTRIES } from "../constants";

const SHORT = new Intl.DisplayNames(["en"], { type: "region" });
/** Each country's names as text says them: its short English name and the catalog's formal one. */
const COUNTRY_NAMES = Object.entries(COUNTRIES).map(([code, formal]) => ({ code, names: [...new Set([SHORT.of(code) ?? formal, formal.split(",")[0]!])].filter((n) => n.length > 3) }));

/** The short forms OpenAlex's lookup writes for a few countries ("Cambridge, UK", "Boston, USA"). */
const ABBREVIATED: Record<string, string> = { uk: "GB", usa: "US", us: "US", uae: "AE" };

/** The ISO code of the country a place names last, or none. */
export function countryOfPlace(place: string | undefined): string {
  const last = place?.split(",").at(-1)?.trim().toLowerCase();
  if (!last) return "";
  return ABBREVIATED[last] ?? COUNTRY_NAMES.find(({ names }) => names.some((n) => n.toLowerCase() === last))?.code ?? "";
}
