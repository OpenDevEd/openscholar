import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";

type Location = FunctionReturnType<typeof api.topics.publications.listLocations>["page"][number];

/** A community's record of the paper, with its PDF and the picture of the PDF's first page when the community has them. */
export type CommunityCopy = { id: string; name: string; url: string; pdf: string | null; cover: string | null };

/** Where a community's record of the paper is, and whose it is. */
export const copyOf = (location: Location) => ({ id: location.id, name: location.library.name, url: new URL(`/lib/${location.itemKey}`, location.library.url).href });
