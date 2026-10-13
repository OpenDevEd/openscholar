import { z } from "zod";

export const DIGEST_MODEL = "openai/gpt-6-luna";
export const DIGEST_REASONING = "max";
/** What kind of work a library reads each record as (new-el's `study-types.ts`). The first five are the reviews and syntheses. */
export const STUDY_TYPES = ["review-of-reviews", "meta-analysis", "systematic-review", "literature-review", "bibliometric", "rct", "quasi-experiment", "quantitative", "qualitative", "modelling", "protocol", "commentary", "not-research"] as const;
export const SYNTHESIS_TYPES = STUDY_TYPES.slice(0, 5);
export const digestRequestSchema = z.object({
  libraryId: z.string().min(1).max(128),
  editionId: z.string().uuid(),
  locale: z.string().min(2).max(35),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  // Every publication the period had; the list below can be a selection of them.
  publicationCount: z.number().int().positive().optional(),
  publications: z.array(z.object({
    key: z.string().regex(/^[A-Z0-9]{8}$/),
    title: z.string().min(1).max(2000),
    creators: z.array(z.string().max(500)).max(100),
    date: z.string().max(100).nullable(),
    abstract: z.string().max(16000).nullable(),
    publicationType: z.string().max(100),
    doi: z.string().max(500).nullable(),
    // What the library read it as, or an editor set. Left out for a record not read yet, and by a library that reads none.
    studyType: z.enum(STUDY_TYPES).optional(),
    // Whether readers can read it without a subscription. Left out when the library does not know.
    openAccess: z.boolean().optional(),
  }).strict()).min(1).max(1000),
}).strict().superRefine((value, ctx) => {
  if (Date.parse(value.periodEnd) <= Date.parse(value.periodStart)) {
    ctx.addIssue({code: "custom", path: ["periodEnd"], message: "The edition must end after it starts"});
  }
  if (new Set(value.publications.map(publication => publication.key)).size !== value.publications.length) {
    ctx.addIssue({code: "custom", path: ["publications"], message: "Publication keys must be unique"});
  }
});
export type DigestRequest = z.infer<typeof digestRequestSchema>;
export const digestResultSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(1000),
  markdown: z.string().min(1).max(50000),
});
