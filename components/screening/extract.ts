// Handing a screening's included papers to extraction. The extraction form opens with them picked among its
// sources, as its own list of screenings would put them (components/extraction/setup-view.tsx): its included
// papers as they stand when the extraction starts, whether or not the screening is finished.

import type { Id } from "@/convex/_generated/dataModel";
import { useExtractionStore } from "@/lib/store/extraction";

/** The form that starts an extraction. */
export const EXTRACT_HREF = "/extraction/new";

/** Puts a screening's included papers among the sources of the extraction about to be set up in this workspace. */
export function pickForExtraction(workspaceId: Id<"workspaces"> | undefined, screening: { id: string; name: string }, included: number) {
  if (workspaceId) useExtractionStore.getState().setSource(workspaceId, { key: `screening:${screening.id}`, set: { kind: "screening", jobId: screening.id as Id<"screeningJobs"> }, label: screening.name, total: included, first: 1, last: Math.max(1, included), scope: "all" });
}
