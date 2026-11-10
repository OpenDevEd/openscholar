import { z } from "zod";

export const topicIdSchema = z.string().regex(/^T[1-9]\d*$/);
const topicNodeIdSchema = z.string().regex(/^(?:T[1-9]\d*|(?:domains|fields|subfields)\/[1-9]\d*)$/);
const topicNodeSchema = z.object({
  id: topicNodeIdSchema, name: z.string().min(1).max(1000),
  parent: topicNodeIdSchema.nullable(),
  level: z.enum(["domain", "field", "subfield", "topic"]),
  path: z.array(z.string().max(1000)).max(4), childCount: z.number().int().nonnegative(),
}).strict();
export type TopicNode = z.infer<typeof topicNodeSchema>;
const envelope = {contractVersion: z.literal(1), libraryId: z.string().min(1).max(128)};
export const topicCatalogRequestSchema = z.object({
  ...envelope, parent: topicNodeIdSchema.nullable().optional(), query: z.string().max(200).optional(),
  ids: z.array(topicNodeIdSchema).max(100).optional(), cursor: z.string().max(8192).nullable().default(null),
  limit: z.number().int().min(1).max(100).default(100),
}).strict().refine(value => [value.parent !== undefined, value.query !== undefined, value.ids !== undefined].filter(Boolean).length === 1, "Choose one catalog operation");
export const topicDetailRequestSchema = z.object({...envelope, topicId: topicIdSchema}).strict();
export const topicAssociationRequestSchema = z.object({
  ...envelope, idempotencyKey: z.string().min(1).max(200), itemKey: z.string().regex(/^[A-Z0-9]{8}$/),
  generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  publishedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  state: z.enum(["published", "unpublished"]), topicIds: z.array(topicIdSchema).max(100),
  openalexId: z.string().regex(/^W[1-9]\d*$/).nullable(), doi: z.string().max(2048).nullable(),
  metadata: z.object({title: z.string().max(10000), date: z.string().max(500).nullable(),
    itemType: z.string().max(100), creators: z.array(z.string().max(1000)).max(1000),
    abstract: z.string().max(100000).nullable(),
    // Its public PDF and the picture of its first page, sent again when either changes; left out by older runtimes.
    pdf: z.object({url: z.string().url().max(2048), cover: z.string().url().max(2048).nullable()}).strict().nullable().optional(),
  }).strict().nullable(),
}).strict().refine(value => value.state === "published" ? value.metadata !== null : value.topicIds.length === 0, "Invalid publication state");
export type TopicAssociationRequest = z.infer<typeof topicAssociationRequestSchema>;
/** Most records one batch carries: Openscholar saves a batch in one transaction. */
export const TOPIC_ASSOCIATION_BATCH_MAX = 50;
/** Longest batch body, in characters: a record's abstract alone may be 100,000. */
export const TOPIC_ASSOCIATION_BATCH_BODY_MAX = 4_000_000;
/**
 * Most weight one batch carries, a record weighing one plus its topics: each topic costs a few index reads, and a
 * transaction may make 4,096. 50 records with up to five topics each fit; a record with more goes in a smaller batch.
 */
export const TOPIC_ASSOCIATION_BATCH_WEIGHT_MAX = 300;
export const topicAssociationWeight = (delivery: {topicIds: readonly string[]}) => 1 + delivery.topicIds.length;
export const topicAssociationBatchRequestSchema = z.object({
  ...envelope, deliveries: z.array(topicAssociationRequestSchema).min(1).max(TOPIC_ASSOCIATION_BATCH_MAX),
}).strict()
  .refine(value => value.deliveries.every(delivery => delivery.libraryId === value.libraryId), "Every delivery belongs to the batch's community")
  .refine(value => new Set(value.deliveries.map(delivery => delivery.itemKey)).size === value.deliveries.length, "One delivery per record")
  .refine(value => value.deliveries.reduce((weight, delivery) => weight + topicAssociationWeight(delivery), 0) <= TOPIC_ASSOCIATION_BATCH_WEIGHT_MAX, "Too many topics for one batch");
