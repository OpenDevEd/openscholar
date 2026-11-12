// The agreement as its signer reads it (plans/publish-reports). The text an admin keeps has the draft's blanks in
// square brackets; what's known is written into them: who signs, the date, and the work once it has a DOI and a title.
// What only Openscholar can say (its legal form, registration and address, and the fees) reads "to be confirmed"
// until that text is settled.

import { LICENCES, type Licence } from "./report";

export type AgreementFacts = {
  name: string;
  date: Date;
  /** The line the work's PDF carries, with its DOI once there is one: the one the upload asks for. */
  byline: string;
  /** The licence the author chose, which `[licence]` names. */
  licence: Licence;
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

export function fillAgreement(text: string, { name, date, byline, licence, doi, title, authors, pages }: AgreementFacts) {
  const signer = name.trim() || "the person signing below";
  const work = title ? `“${title}”${authors?.length ? `, by ${authors.join(", ")}` : ""}${pages ? `, ${pages} ${pages === 1 ? "page" : "pages"}` : ""}` : "the work the Author uploads for publication after signing";
  return (
    text
      // The note to the people drafting it isn't part of what's signed.
      .replace(/^Draft for discussion.*\n+/m, "")
      .replaceAll("[date]", day(date))
      .replaceAll("[byline]", `“${byline}”`)
      .replaceAll("[licence]", licenceWords(licence))
      .replaceAll("[Name of author(s) or organisation], of [address]", signer)
      .replaceAll("[Name of author(s) or organisation]", signer)
      .replaceAll("[title], by [authors], [number of pages], [date of completion]", work)
      .replaceAll("https://doi.org/[prefix]/[suffix]", doi ? `https://doi.org/${doi}` : "reserved when the Author signs")
      // The author's signature line carries who signs and when; Openscholar's stays open.
      .replace(/(Signed for the Author:)\s*_+\s*Name, date/, `$1 ${signer}, ${day(date)}`)
      .replace(/(Signed for Openscholar:)\s*_+\s*Name, role, date/, "$1 (to be confirmed)")
      // Whatever is left is Openscholar's to settle.
      .replace(/\[[^\][]*(?:\[[^\][]*\][^\][]*)*\]/g, "(to be confirmed)")
  );
}
