import "server-only";
import { unstable_cache } from "next/cache";
import { fetchPublicationCard, fetchPublicationPdf } from "./publication-cards";

/** A publication's card for the app's own pages, kept for a minute. */
export const readPublicationCard = unstable_cache(fetchPublicationCard, ["evidence-library-publication-card"], {revalidate: 60});
/**
 * A community record's PDF and the picture of its first page: the slow part, read from the community, so kept a minute.
 * The community adds them after it publishes the record, so a reload soon after shows them.
 */
export const readPublicationPdf = unstable_cache(fetchPublicationPdf, ["evidence-library-publication-pdf"], {revalidate: 60});
