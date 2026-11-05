import { ownWork } from "../papers/paper-ref";

/** An OpenAlex ID of one kind, bare and upper case, from the ID or the address it was given as; undefined for anything else. */
export const openAlexId = (letter: string) => (value: string) =>
  value.trim().match(new RegExp(`^(?:https?://openalex\\.org/(?:[a-z]+/)?)?(${letter}\\d+)$`, "i"))?.[1].toUpperCase();
/** A journal's ID, OpenAlex's or our index's (OSV1), bare and upper case; undefined for anything else. */
export const sourceId = (value: string) => value.trim().match(/^(?:https?:\/\/openscholar\.ai\/)?(OSV\d+)$/i)?.[1].toUpperCase() ?? openAlexId("S")(value);
export const institutionId = openAlexId("I");
/** A paper's ID, OpenAlex's or our index's (OS1), bare and upper case; undefined for anything else. */
export const workId = (value: string) => openAlexId("W")(value) ?? ownWork(value) ?? undefined;
/** A paper's ID from what a search saved: older ones hold its address. Anything else stays as it was saved. */
export const bareWork = (value: string) => workId(value) ?? value;
