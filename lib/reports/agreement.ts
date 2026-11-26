// The agreement as its signer reads it (plans/publish-reports). The text an admin keeps has blanks in square
// brackets; what's known is written into them: who signs, the date, the identifiers and archive the report gets, and
// the work once it has a DOI and a title. A blank nothing fills reads "to be confirmed".

import type { ServiceId } from "./identifiers";
import { LICENCES, type Licence } from "./report";

export type AgreementFacts = {
  name: string;
  date: Date;
  /** The line the work's PDF carries, with its DOI once there is one: the one the upload asks for. */
  byline: string;
  /** The licence the author chose, which `[licence]` names. */
  licence: Licence;
  /** The services the report registers with, as signing fixes them (`routeOf`), which `[identifiers]` names. */
  services: ServiceId[];
  /** Its copy is archived in the signer's own Zenodo account, not Openscholar's. */
  ownArchive: boolean;
  doi?: string;
  title?: string;
  authors?: string[];
  pages?: number;
};

const day = (date: Date) => date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

/** An agreement whose author chooses the licence: one that names a licence of its own offers only CC BY 4.0. */
export const choosesLicence = (text: string) => text.includes("[licence]");

/** A licence as the agreement names it: in full, with its short name and the address of its text. */
const licenceWords = (licence: Licence) =>
  typeof licence === "string" ? `the ${LICENCES[licence].title} licence (${licence}, ${LICENCES[licence].url})` : `the licence “${licence.name}” (${licence.url})`;

/** What Openscholar does with the work's identifiers and copy, as one sentence: "Openscholar will register a DOI … and …". */
function identifierWords(services: ServiceId[], ownArchive: boolean) {
  const does = [
    services.includes("crossref") && "register a DOI for the Work with Crossref",
    services.includes("docid") && "register a DOCiD for the Work with the Africa PID Alliance",
    services.includes("zenodo") && (ownArchive ? "archive a copy of the Work in the Author’s own Zenodo account" : "archive a copy of the Work on Zenodo"),
  ].filter((part): part is string => !!part);
  return does.length ? `Openscholar will ${does.slice(0, -1).join(", ")}${does.length > 1 ? " and " : ""}${does.at(-1)}.` : "";
}

export function fillAgreement(text: string, { name, date, byline, licence, services, ownArchive, doi, title, authors, pages }: AgreementFacts) {
  const signer = name.trim() || "the person signing below";
  const work = title ? `“${title}”${authors?.length ? `, by ${authors.join(", ")}` : ""}${pages ? `, ${pages} ${pages === 1 ? "page" : "pages"}` : ""}` : "the work the Author uploads for publication after signing";
  return (
    text
      // Versions signed before the final text open with a note to the people drafting it, which isn't part of what's signed.
      .replace(/^Draft for discussion.*\n+/m, "")
      .replaceAll("[date]", day(date))
      .replaceAll("[byline]", `“${byline}”`)
      .replaceAll("[licence]", licenceWords(licence))
      .replaceAll("[identifiers]", identifierWords(services, ownArchive))
      .replaceAll("[Name of author(s) or organisation], of [address]", signer)
      .replaceAll("[Name of author(s) or organisation]", signer)
      .replaceAll("[title], by [authors], [number of pages], [date of completion]", work)
      .replaceAll("https://doi.org/[prefix]/[suffix]", doi ? `https://doi.org/${doi}` : "reserved when the Author signs")
      // The author's signature line carries who signs and when. Versions before the final text had a line for
      // Openscholar too, left open; Openscholar now accepts by publishing.
      .replace(/(Signed for the Author:)\s*_+\s*Name, date/, `$1 ${signer}, ${day(date)}`)
      .replace(/(Signed for Openscholar:)\s*_+\s*Name, role, date/, "$1 (to be confirmed)")
      // Whatever is left is Openscholar's to settle.
      .replace(/\[[^\][]*(?:\[[^\][]*\][^\][]*)*\]/g, "(to be confirmed)")
  );
}
