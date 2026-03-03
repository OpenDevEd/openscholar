import type { Infer } from "convex/values";
import { extractionResultWithReviewValidator } from "@/convex/extraction/validators";

/** TypeScript type derived from the Convex validator -- stays in sync automatically. */
export type ExtractionResultWithReview = Infer<typeof extractionResultWithReviewValidator>;
