import type { Id } from "@/convex/_generated/dataModel";
export type OpenAlexMatch = {id: string; name: string; affiliation: string; topics: string; works: string[]};
export type AuthorProfile = {
  id: Id<"authorProfiles">;
  name: string; headline: string; affiliation: string; bio: string;
  website: string; linkedin: string; orcid: string; openalex: string;
  photo?: string; featured: string[]; match?: OpenAlexMatch;
};
export type AuthorPublication = {
  id: string; title: string; type: string; year: string; authors: string;
  cover?: string; pages?: number; url: string;
  library: {id: string; name: string; url: string; icon?: string};
};
