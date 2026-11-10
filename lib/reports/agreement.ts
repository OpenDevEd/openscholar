// The agreement as its signer reads it (plans/publish-reports). The text an admin keeps has the draft's blanks in
// square brackets; what's known is written into them: who signs, the date, and the work once it has a DOI and a title.
// What only Openscholar can say (its legal form, registration and address, and the fees) reads "to be confirmed"
// until that text is settled.

export type AgreementFacts = { name: string; date: Date; doi?: string; title?: string; authors?: string[]; pages?: number };

const day = (date: Date) => date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

export function fillAgreement(text: string, { name, date, doi, title, authors, pages }: AgreementFacts) {
  const signer = name.trim() || "the person signing below";
  const work = title ? `“${title}”${authors?.length ? `, by ${authors.join(", ")}` : ""}${pages ? `, ${pages} ${pages === 1 ? "page" : "pages"}` : ""}` : "the work the Author uploads for publication after signing";
  return (
    text
      // The note to the people drafting it isn't part of what's signed.
      .replace(/^Draft for discussion.*\n+/m, "")
      .replaceAll("[date]", day(date))
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
