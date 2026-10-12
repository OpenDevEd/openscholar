import type { Doc } from "../_generated/dataModel";

/**
 * Every address an invitation to a person may have been sent to, in lower case: their account's own, and the others
 * Clerk has verified on it. Until the Clerk webhook has kept those (`verifiedEmails`), their own.
 */
export const addressesOf = (person: Pick<Doc<"users">, "email" | "verifiedEmails">) => [...new Set([person.email, ...(person.verifiedEmails ?? [])].map((email) => email.trim().toLowerCase()))];

/** A person's name as the app shows it: their first and last names, or nothing when they gave none. */
export const personName = (person: Doc<"users">) => [person.firstName, person.lastName].filter(Boolean).join(" ");
