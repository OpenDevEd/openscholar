/** An OpenAlex ID of one kind, bare and upper case, from the ID or the address it was given as; undefined for anything else. */
export const openAlexId = (letter: string) => (value: string) =>
  value.trim().match(new RegExp(`^(?:https?://openalex\\.org/(?:[a-z]+/)?)?(${letter}\\d+)$`, "i"))?.[1].toUpperCase();
export const sourceId = openAlexId("S");
export const institutionId = openAlexId("I");
