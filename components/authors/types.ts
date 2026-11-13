import type { Id } from "@/convex/_generated/dataModel";
export type OpenAlexMatch = {id: string; name: string; affiliation: string; topics: string; works: string[]};
export type AuthorProfile = {
  id: Id<"authorProfiles">;
  revision: number;
  name: string; headline: string; affiliation: string; bio: string;
  website: string; linkedin: string; orcid: string; openalex: string;
  photo?: string; featured: string[]; match?: OpenAlexMatch;
};
export type AuthorPublication = {
  id: string; title: string; type: string; year: string; authors: string;
  cover?: string; pages?: number; url: string;
  /** Its PDF as its community last said: where it opens, or null when the record has none. Absent when that isn't known. */
  pdf?: { url: string } | null;
  library: {id: string; name: string; url: string; icon?: string};
};
/** Profiles per page of the Authors list: the server sends the first with the page, the browser reads the rest. */
export const AUTHOR_PAGE_SIZE = 20;
