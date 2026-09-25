import "server-only";
import { fetchAction } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

// The catalog is seeded once per deployment and catalog revision, so each
// server process checks it once. A failed check is retried on the next request.
let catalogReady: Promise<unknown> | undefined;
export function ensureTopicCatalog() {
  catalogReady ??= fetchAction(api.topics.catalog.initialize, {}).catch((error: unknown) => {
    catalogReady = undefined;
    throw error;
  });
  return catalogReady;
}
