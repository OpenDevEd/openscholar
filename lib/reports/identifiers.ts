// Identifier services (plans/identifier-services): which registrars a publisher's records get identifiers from, how
// each is used (required, optional, off), what each adds to the price, what authors may pick, and which identifier
// the byline prints. Reports and communities share the shape; only Reports charge.

export const SERVICES = {
  crossref: { name: "Crossref", identifier: "DOI", logo: "/brands/crossref.svg", printable: true },
  zenodo: { name: "Zenodo", identifier: "DOI", logo: "/brands/zenodo.svg", printable: false },
  docid: { name: "DOCiD", identifier: "Handle", logo: "/brands/docid.png", printable: "atSigning" },
} as const;
export type ServiceId = keyof typeof SERVICES;
export const SERVICE_IDS = Object.keys(SERVICES) as ServiceId[];

export type ServiceMode = "required" | "optional" | "off";
export type Identifiers = {
  services: Record<ServiceId, { mode: ServiceMode; price: number }>;
  /** How many of the optional services an author picks: at least `min`, at most `max`. */
  choose: { min: number; max: number };
  /** In order: the first chosen service that can be printed is the identifier the byline prints. */
  citeFirst: ServiceId[];
  /** DOCiD is minted at signing, so its Handle can be printed; a declined report's Handle is then retired. */
  docidAtSigning: boolean;
};

/** What every publisher has before its admin changes anything: Crossref and its Zenodo copy, as before. */
export const DEFAULT_IDENTIFIERS: Identifiers = {
  services: { crossref: { mode: "required", price: 0 }, zenodo: { mode: "required", price: 0 }, docid: { mode: "off", price: 0 } },
  choose: { min: 0, max: 3 },
  citeFirst: ["crossref", "docid"],
  docidAtSigning: false,
};

export const optionalOf = (ids: Identifiers) => SERVICE_IDS.filter((id) => ids.services[id].mode === "optional");
export const requiredOf = (ids: Identifiers) => SERVICE_IDS.filter((id) => ids.services[id].mode === "required");

/** Whether a service's identifier can go in the byline: it has to exist before review. */
export const printable = (ids: Identifiers, id: ServiceId) => SERVICES[id].printable === true || (SERVICES[id].printable === "atSigning" && ids.docidAtSigning);

/** Zenodo keeps the copy a Crossref DOI must lead to (#1465): chosen with Crossref whatever its mode. */
export function withNeeded(ids: Identifiers, chosen: ServiceId[]): ServiceId[] {
  const all = new Set([...requiredOf(ids), ...chosen]);
  if (all.has("crossref") && ids.services.zenodo.mode !== "off") all.add("zenodo");
  return SERVICE_IDS.filter((id) => all.has(id));
}

/** What the services chosen add to a report's price, in dollars. */
export const addOnsOf = (ids: Identifiers, chosen: ServiceId[]) => withNeeded(ids, chosen).reduce((sum, id) => sum + ids.services[id].price, 0);

/** The identifier a report with these services prints in its byline, or null when none of them can be. */
export const citedOf = (ids: Identifiers, chosen: ServiceId[]) => {
  const all = withNeeded(ids, chosen);
  return ids.citeFirst.find((id) => all.includes(id) && printable(ids, id)) ?? null;
};

/** What an author's pick of optional services lacks, or null when it can be signed. */
export function pickProblem(ids: Identifiers, picked: ServiceId[]): "tooFew" | "tooMany" | "nothingPrinted" | null {
  const optional = optionalOf(ids).filter((id) => picked.includes(id));
  if (optional.length < ids.choose.min) return "tooFew";
  if (optional.length > ids.choose.max) return "tooMany";
  return citedOf(ids, picked) ? null : "nothingPrinted";
}

/**
 * What can't work in settings an admin is saving, said at the field. Every pick an author can make must leave the
 * byline something to print, and the rule has to allow at least one pick.
 */
export function settingsProblem(ids: Identifiers): "noService" | "rule" | "nothingPrinted" | null {
  const optional = optionalOf(ids);
  if (!requiredOf(ids).length && !optional.length) return "noService";
  if (ids.choose.min > ids.choose.max || ids.choose.min > optional.length) return "rule";
  // The weakest pick: the required services alone, or with the fewest optional ones the rule allows.
  const picks = subsets(optional).filter((pick) => pick.length >= ids.choose.min && pick.length <= ids.choose.max);
  return picks.every((pick) => citedOf(ids, pick)) ? null : "nothingPrinted";
}

function subsets<T>(items: T[]): T[][] {
  return items.reduce<T[][]>((all, item) => all.concat(all.map((set) => [...set, item])), [[]]);
}
