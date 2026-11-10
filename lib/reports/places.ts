// The country a place's name ends in, for an institution OpenAlex's lookup describes as "Accra, Ghana".
import { COUNTRIES } from "../constants";

const SHORT = new Intl.DisplayNames(["en"], { type: "region" });
/** Each country's names as text says them: its short English name and the catalog's formal one. */
const COUNTRY_NAMES = Object.entries(COUNTRIES).map(([code, formal]) => ({ code, names: [...new Set([SHORT.of(code) ?? formal, formal.split(",")[0]!])].filter((n) => n.length > 3) }));

/** The ISO code of the country a place names last, or none. */
export function countryOfPlace(place: string | undefined): string {
  const last = place?.split(",").at(-1)?.trim();
  if (!last) return "";
  return COUNTRY_NAMES.find(({ names }) => names.some((n) => n.toLowerCase() === last.toLowerCase()))?.code ?? "";
}
