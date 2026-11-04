/** An OpenAlex ID of one kind, bare and upper case, from the ID or the address it was given as; undefined for anything else. */
export const openAlexId = (letter: string) => (value: string) =>
  value.trim().match(new RegExp(`^(?:https?://openalex\\.org/(?:[a-z]+/)?)?(${letter}\\d+)$`, "i"))?.[1].toUpperCase();
/** A journal's ID, OpenAlex's or our index's (OSV1), bare and upper case; undefined for anything else. */
export const sourceId = (value: string) => value.trim().match(/^(?:https?:\/\/openscholar\.ai\/)?(OSV\d+)$/i)?.[1].toUpperCase() ?? openAlexId("S")(value);
export const institutionId = openAlexId("I");
