import type { Doc } from "../_generated/dataModel";

/** A person's name as the app shows it: their first and last names, or nothing when they gave none. */
export const personName = (person: Doc<"users">) => [person.firstName, person.lastName].filter(Boolean).join(" ");
