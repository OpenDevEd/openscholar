import { parseAsString, parseAsStringLiteral } from "nuqs/server";
import { sharedKinds } from "@/convex/sharing/validators";

/** Shared items one page of "Shared with me" shows: the page its route reads on the server, and each page more. */
export const SHARED_PAGE = 25;

/** What Shared with me shows, as its address keeps it: the kind, the order and the search. Its route reads the same, to send the first rows of that view (app/shared/page.tsx). */
export const SHARED_PLACE = {
  kind: parseAsStringLiteral(sharedKinds),
  sort: parseAsStringLiteral(["recent", "name"] as const).withDefault("recent"),
  q: parseAsString.withDefault(""),
};
