import "server-only";
import { unstable_cache } from "next/cache";
import { fetchPublicationCard } from "./publication-cards";

/** A publication's card for the app's own pages, kept for a minute. */
export const readPublicationCard = unstable_cache(fetchPublicationCard, ["evidence-library-publication-card"], {revalidate: 60});
