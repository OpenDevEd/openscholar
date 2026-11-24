// Identifier services (plans/identifier-services): which registrars a publisher's records get identifiers from, how
// each is used (required, optional, off), what each adds to the price, what authors may pick, and which identifier
// the byline prints. Reports and communities share the shape; only Reports charge.
import { docidResourceType, type DocidOption } from "@opendeved/doi-sync-core/docid";

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

/** The services a report registers with, as its route has them. */
export const chosenOf = (r: { crossref: boolean; zenodo: boolean; docid?: boolean | undefined }): ServiceId[] => SERVICE_IDS.filter((id) => r[id] === true);

/** What a report's services add to its price, in dollars, as the settings price them now. */
export const routeAddOns = (ids: Identifiers, r: { crossref: boolean; zenodo: boolean; docid?: boolean | undefined }) => chosenOf(r).reduce((sum, id) => sum + ids.services[id].price, 0);

/**
 * A report's route as signing fixes it, and as its price is reckoned before and after: the series' services and the
 * author's picks, Zenodo with any Crossref DOI, and Zenodo too when the author archives in their own account.
 */
export function routeOf(ids: Identifiers, picked: ServiceId[], ownArchive: boolean) {
  const gets = withNeeded(ids, picked);
  return { crossref: gets.includes("crossref"), zenodo: ownArchive || gets.includes("zenodo"), docid: gets.includes("docid") };
}

/**
 * The pick rule kept possible as services move between modes: never more picks than there are optional services, and
 * "any of them" (a maximum of all of them) staying all of them.
 */
export function clampChoose(next: Identifiers, before: Identifiers): Identifiers {
  const now = optionalOf(next).length;
  const all = (ids: Identifiers) => optionalOf(ids).length;
  const max = before.choose.max >= all(before) ? now : Math.min(before.choose.max, now);
  return { ...next, choose: { min: Math.min(next.choose.min, max), max } };
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
  const { min, max } = ids.choose;
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || min > max || min > optional.length) return "rule";
  // Every pick the rule allows has to leave the byline something to print, and the rule has to allow one.
  const picks = subsets(optional).filter((pick) => pick.length >= min && pick.length <= max);
  if (!picks.length) return "rule";
  return picks.every((pick) => citedOf(ids, pick)) ? null : "nothingPrinted";
}

type Accounts = { crossref: { mode: string }; zenodo: { mode: string }; docid?: { mode: string; options?: { resourceTypes: DocidOption[] } | undefined } | undefined };

/** Whether DOCiD can take a deposit: its account set, and allowed to file a report under the resource type reports map to. */
export const docidReady = (publication: Accounts) => publication.docid?.mode === "custom" && docidResourceType("Report", publication.docid.options?.resourceTypes ?? []) !== undefined;

/** Which services' accounts are set under Registration, ready to register a report. */
export const connectedOf = (publication: Accounts): Record<ServiceId, boolean> => ({ crossref: publication.crossref.mode !== "off", zenodo: publication.zenodo.mode !== "off", docid: docidReady(publication) });

/** The settings with every service whose account is off under Registration switched off too. */
export function withAccounts(ids: Identifiers, publication: Accounts): Identifiers {
  const connected = connectedOf(publication);
  return { ...ids, services: Object.fromEntries(SERVICE_IDS.map((id) => [id, connected[id] ? ids.services[id] : { ...ids.services[id], mode: "off" as const }])) as Identifiers["services"] };
}

/** What `settingsProblem` finds, in the words the admin page and the server both say. */
export const SETTINGS_PROBLEM = {
  noService: "Turn on at least one service, or reports get no identifier.",
  rule: "The rule asks for more picks than there are services to pick.",
  nothingPrinted: "Some picks leave the byline nothing to print. Put Crossref first, or mint DOCiDs at signing.",
} as const;

function subsets<T>(items: T[]): T[][] {
  return items.reduce<T[][]>((all, item) => all.concat(all.map((set) => [...set, item])), [[]]);
}
